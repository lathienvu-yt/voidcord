#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discord_router;
mod settings_proto;
mod settings_menu;
mod voice_gateway;

use discord_router::DiscordRouter;
use std::{collections::HashMap, io::{BufWriter, Write}, path::PathBuf, process::{Child, ChildStdin}, sync::{atomic::{AtomicBool, Ordering}, mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError}, Arc, Mutex as StdMutex, OnceLock}, time::Duration};
use tokio::sync::Mutex;
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use voice_gateway::VoiceControlState;
use tauri::Manager;


struct RustConsoleProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
}

static CONSOLE_PROCESS: OnceLock<StdMutex<Option<RustConsoleProcess>>> = OnceLock::new();
static AUTO_REOPEN_CONSOLE: AtomicBool = AtomicBool::new(false);
static LOG_CHANNEL: OnceLock<SyncSender<String>> = OnceLock::new();

pub fn open_rust_console_window() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let slot = CONSOLE_PROCESS.get_or_init(|| StdMutex::new(None));
        let mut current = slot.lock().map_err(|_| "Rust console lock poisoned".to_owned())?;

        // A closed PowerShell window closes its stdin pipe. Do not mistake the
        // stale BufWriter for a live console: reap the child and replace it.
        if let Some(console) = current.as_mut() {
            match console.child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => *current = None,
            }
        }

        let script = "$Host.UI.RawUI.WindowTitle = 'VoidCord Rust Console'; while ($true) { $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }; [Console]::WriteLine($line) }";
        let mut child = std::process::Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-Command", script])
            .creation_flags(0x00000010)
            .stdin(std::process::Stdio::piped())
            .spawn().map_err(|e| format!("Could not open Rust console: {e}"))?;
        let stdin = child.stdin.take().ok_or_else(|| "Rust console stdin unavailable".to_owned())?;
        *current = Some(RustConsoleProcess { child, stdin: BufWriter::new(stdin) });
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("Separate Rust console is supported on Windows only.".to_owned()) }
}

struct BackendLogger;

impl log::Log for BackendLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            let thread = std::thread::current();
            let thread_name = thread.name().unwrap_or("unnamed");
            let line = format!(
                "[{}] [thread={} id={:?}] {}: {}",
                record.level(),
                thread_name,
                thread.id(),
                record.target(),
                record.args()
            );
            
            // Print to standard error instantly
            eprintln!("{line}");
            
            // Never block the caller on console I/O or a full logging queue.
            // Under extreme log floods, a full queue intentionally drops console copies.
            if let Some(tx) = LOG_CHANNEL.get() {
                match tx.try_send(line) {
                    Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
                }
            }
        }
    }

    fn flush(&self) {}
}

fn run_console_log_writer(receiver: Receiver<String>) {
    loop {
        let first = match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        let mut batch = vec![first];
        // Gather queued lines so console writes and flushes are amortized.
        while batch.len() < 64 {
            match receiver.try_recv() {
                Ok(line) => batch.push(line),
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }

        // If the user closed PowerShell, the next log batch recreates it.
        // The flag is enabled only when startup tracing requested an auto console.
        if AUTO_REOPEN_CONSOLE.load(Ordering::Relaxed) {
            let _ = open_rust_console_window();
        }
        if let Some(slot) = CONSOLE_PROCESS.get() {
            if let Ok(mut guard) = slot.lock() {
                if let Some(console) = guard.as_mut() {
                    let mut write_failed = false;
                    for line in &batch {
                        if writeln!(console.stdin, "{line}").is_err() {
                            write_failed = true;
                            break;
                        }
                    }
                    if console.stdin.flush().is_err() { write_failed = true; }
                    if write_failed {
                        // Drop the stale pipe now; the next batch can reopen it.
                        *guard = None;
                    }
                }
            }
        }
    }
}

static BACKEND_LOGGER: BackendLogger = BackendLogger;

pub struct AppState {
    pub router: DiscordRouter,
    pub token: Arc<Mutex<Option<String>>>,
    pub selected_uploads: Mutex<HashMap<String, (tokio::time::Instant, Vec<PathBuf>)>>,
    pub gateway_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub voice_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub voice_controls: VoiceControlState,
}

fn main() {
    let default_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("unnamed");
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "<unknown location>".to_owned());
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| panic_info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("<non-string panic payload>");
        eprintln!("[PANIC] thread={} id={:?} at {}: {}", thread_name, thread.id(), location, payload);
        log::error!(
            target: "panic",
            "panic on thread={} id={:?} at {}: {}",
            thread_name,
            thread.id(),
            location,
            payload
        );
        default_panic_hook(panic_info);
    }));

    // A bounded queue prevents log floods from growing memory without limit.
    // The writer thread batches console output; the logging caller never waits on it.
    let (log_tx, log_rx) = mpsc::sync_channel::<String>(1024);
    LOG_CHANNEL.set(log_tx).expect("failed to initialize Rust log channel");

    std::thread::Builder::new()
        .name("voidcord-log-writer".to_owned())
        .spawn(move || run_console_log_writer(log_rx))
        .expect("failed to start Rust console log writer thread");

    log::set_logger(&BACKEND_LOGGER).expect("failed to initialize Rust backend logger");
    let verbose_network_trace = std::env::var("VOIDCORD_TRACE_NETWORK")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    log::set_max_level(if verbose_network_trace || cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    });
    eprintln!(
        "[BOOT] VOIDCORD_TRACE_NETWORK={} => verbose_payload_logging={}",
        std::env::var("VOIDCORD_TRACE_NETWORK").unwrap_or_else(|_| "<unset>".to_owned()),
        verbose_network_trace
    );
    if verbose_network_trace {
        AUTO_REOPEN_CONSOLE.store(true, Ordering::Relaxed);
        // Release builds use the Windows GUI subsystem, so stdout/stderr are not
        // attached to a terminal. Open the app's dedicated Rust log console before
        // emitting the startup banner and verbose request/event traces.
        #[cfg(windows)]
        if let Err(error) = open_rust_console_window() {
            eprintln!("[WARN] Could not open verbose Rust console: {error}");
        }
        log::warn!("Verbose network tracing enabled; payloads are redacted and bounded, but message content and other private data may still appear in local logs.");
    }
    log::info!("VoidCord Rust backend starting (debug_assertions={})", cfg!(debug_assertions));

    let app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            log::warn!("Another instance tried to launch with args: {:?} from {}", args, cwd);
            // Bring the primary window to the front instead of opening a duplicate app
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build());


    #[cfg(debug_assertions)]
    let app_builder = app_builder.plugin(tauri_plugin_devtools::init());

    app_builder
        .setup(|app| {
            let file = Submenu::with_items(app, "File", true, &[
                &MenuItem::with_id(app, "reload", "Reload VoidCord", true, None::<String>)?,
                &MenuItem::with_id(app, "close", "Close window", true, None::<String>)?,
            ])?;
            let devtool = Submenu::with_items(app, "DevTool", true, &[
                &MenuItem::with_id(app, "devtools", "Toggle WebView DevTools", true, None::<String>)?,
            ])?;
            let view = Submenu::with_items(app, "View", true, &[
                &MenuItem::with_id(app, "reload", "Reload interface", true, None::<String>)?,
            ])?;
            let logs = Submenu::with_items(app, "Logs", true, &[
                &MenuItem::with_id(app, "deleted-log", "Deleted messages log", true, None::<String>)?,
            ])?;
            let menu = Menu::with_items(app, &[&file, &devtool, &view, &logs, &PredefinedMenuItem::separator(app)?])?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("native-menu-action", event.id().as_ref());
            });
            Ok(())
        })
        .manage(AppState {
            router: DiscordRouter::default(),
            token: Arc::new(Mutex::new(None)),
            selected_uploads: Mutex::new(HashMap::new()),
            gateway_task: Mutex::new(None),
            voice_task: Mutex::new(None),
            voice_controls: VoiceControlState::default(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_token,
            commands::get_current_user,
            commands::get_content_inventory,
            commands::get_guilds,
            commands::retry_captcha_request,
            commands::join_guild_invite,
            commands::create_guild,
            commands::get_dm_channels,
            commands::get_relationships,
            commands::get_message_requests,
            commands::update_message_request,
            commands::batch_reject_message_requests,
            commands::create_dm,
            commands::add_friend,
            commands::update_relationship,
            commands::set_presence,
            commands::update_bio,
            commands::get_current_user_settings,
            commands::get_guild_folder_settings,
            commands::sync_settings_proto_v1,
            settings_menu::save_client_settings,
            commands::get_user_profile,
            commands::get_channels,
            commands::get_messages,
            commands::get_message,
            commands::get_notification_center_items,
            commands::ack_notification_center_item,
            commands::acknowledge_message,
            commands::archive_message_media,
            commands::send_message,
            commands::send_message_with_files,
            commands::get_global_application_commands,
            commands::get_guild_application_commands,
            commands::get_guild_application_command_permissions,
            commands::execute_application_command,
            commands::execute_component_interaction,
            commands::decline_private_call,
            commands::select_attachment_files,
            commands::get_upload_limit,
            commands::forward_message,
            commands::edit_message,
            commands::delete_message,
            commands::react_to_message,
            commands::moderate_guild_member,
            commands::set_guild_member_nickname,
            commands::update_guild_channel,
            commands::set_voice_channel_status,
            commands::set_guild_channel_locked,
            commands::delete_guild_channel,
            commands::start_gateway,
            commands::toggle_devtools,
            commands::open_rust_console,
            commands::request_guild_member_list,
            commands::set_voice_state,
            commands::list_audio_devices,
            commands::get_guild_roles,
            commands::get_current_guild_member,
            commands::connect_voice,
            commands::disconnect_voice,
            commands::get_screen_sources,
            commands::start_screen_share,
            commands::stop_screen_share,
            commands::export_vcc_file,
            commands::pick_vcc_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VoidCord");

    log::info!("VoidCord application exited");
}
