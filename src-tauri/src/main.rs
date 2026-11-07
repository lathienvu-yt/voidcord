#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cache;
mod commands;
mod discord_router;
mod gpui_console;
mod rpc;
mod settings_menu;
mod settings_proto;
mod voice_gateway;

use cache::LocalCache;
use discord_router::{DiscordRouter, TokenManager};
use rpc::RpcState;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError},
        Arc, OnceLock,
    },
    time::Duration,
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;
use tauri::Manager;
use tokio::sync::Mutex;
use voice_gateway::VoiceControlState;

static LOG_CHANNEL: OnceLock<SyncSender<String>> = OnceLock::new();

pub fn open_rust_console_window(app: &tauri::AppHandle) -> Result<(), String> {
    gpui_console::toggle(app)
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

            // Never block the caller on console rendering or a full logging queue.
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

        gpui_console::append_logs(&batch);
    }
}

static BACKEND_LOGGER: BackendLogger = BackendLogger;

pub struct AppState {
    pub router: DiscordRouter,
    pub rpc: RpcState,
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
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("<non-string panic payload>");
        eprintln!(
            "[PANIC] thread={} id={:?} at {}: {}",
            thread_name,
            thread.id(),
            location,
            payload
        );
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
    LOG_CHANNEL
        .set(log_tx)
        .expect("failed to initialize Rust log channel");

    std::thread::Builder::new()
        .name("voidcord-log-writer".to_owned())
        .spawn(move || run_console_log_writer(log_rx))
        .expect("failed to start Rust console log writer thread");

    log::set_logger(&BACKEND_LOGGER).expect("failed to initialize Rust backend logger");
    let trace_env_raw =
        std::env::var("VOIDCORD_TRACE_NETWORK").unwrap_or_else(|_| "<unset>".to_owned());
    let verbose_network_trace = matches!(
        trace_env_raw.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    );
    eprintln!(
        "[BOOT] VOIDCORD_TRACE_NETWORK={} => verbose_payload_logging={}",
        trace_env_raw, verbose_network_trace
    );
    log::set_max_level(if verbose_network_trace {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    });
    if verbose_network_trace {
        log::warn!("Verbose network tracing enabled; payloads are redacted and bounded, but message content and other private data may still appear in local logs.");
    }
    log::info!(
        "VoidCord Rust backend starting (debug_assertions={})",
        cfg!(debug_assertions)
    );

    let app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            log::warn!(
                "Another instance tried to launch with args: {:?} from {}",
                args,
                cwd
            );
            // Bring the primary window to the front instead of opening a duplicate app
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));

    #[cfg(debug_assertions)]
    let app_builder = app_builder.plugin(tauri_plugin_devtools::init());

    app_builder
        .setup(|app| {
            let file = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "reload", "Reload VoidCord", true, None::<String>)?,
                    &MenuItem::with_id(app, "close", "Close window", true, None::<String>)?,
                ],
            )?;
            let devtool = Submenu::with_items(
                app,
                "DevTool",
                true,
                &[&MenuItem::with_id(
                    app,
                    "devtools",
                    "Toggle WebView DevTools",
                    true,
                    None::<String>,
                )?],
            )?;
            let view = Submenu::with_items(
                app,
                "View",
                true,
                &[&MenuItem::with_id(
                    app,
                    "reload",
                    "Reload interface",
                    true,
                    None::<String>,
                )?],
            )?;
            let logs = Submenu::with_items(
                app,
                "Logs",
                true,
                &[&MenuItem::with_id(
                    app,
                    "deleted-log",
                    "Deleted messages log",
                    true,
                    None::<String>,
                )?],
            )?;
            let menu = Menu::with_items(
                app,
                &[
                    &file,
                    &devtool,
                    &view,
                    &logs,
                    &PredefinedMenuItem::separator(app)?,
                ],
            )?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("native-menu-action", event.id().as_ref());
            });
            let app_data_dir = app.path().app_data_dir()?;
            let cache_path = app_data_dir.join("rocksdb-cache");
            let cache = LocalCache::open(&cache_path)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(AppState {
                router: DiscordRouter::with_installation_id_path(
                    TokenManager::default(),
                    app_data_dir.join("discord-installation-id"),
                ),
                rpc: RpcState::default(),
                token: Arc::new(Mutex::new(None)),
                selected_uploads: Mutex::new(HashMap::new()),
                gateway_task: Mutex::new(None),
                voice_task: Mutex::new(None),
                voice_controls: VoiceControlState::default(),
            });
            app.manage(cache);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cache::cache_get,
            cache::cache_get_all,
            cache::cache_put,
            cache::cache_put_many,
            cache::cache_delete,
            cache::cache_merge_messages,
            cache::cache_mark_message_deleted,
            cache::cache_delete_log,
            cache::cache_migration_complete,
            cache::cache_finish_migration,
            cache::cache_get_deleted_messages_for_channel,
            commands::set_token,
            commands::set_router_accounts,
            commands::get_current_user,
            commands::get_oauth2_authorize,
            commands::submit_oauth2_authorize,
            commands::complete_oauth2_redirect,
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
            commands::set_user_ignored,
            commands::set_presence,
            commands::detect_running_game,
            commands::set_game_activity,
            commands::set_custom_rpc_activity,
            commands::set_rpc_listener_enabled,
            commands::update_bio,
            commands::get_current_user_settings,
            commands::get_guild_folder_settings,
            commands::sync_settings_proto_v1,
            settings_menu::save_client_settings,
            commands::get_user_profile,
            commands::get_safety_hub,
            commands::get_report_reasons,
            commands::create_report,
            commands::get_channels,
            commands::get_active_guild_threads,
            commands::get_channel_threads,
            commands::get_messages,
            commands::get_message,
            commands::get_notification_center_items,
            commands::ack_notification_center_item,
            commands::acknowledge_message,
            commands::archive_message_media,
            commands::send_message,
            commands::send_message_with_files,
            commands::get_rpc_application,
            commands::get_global_application_commands,
            commands::get_guild_application_commands,
            commands::get_guild_application_command_permissions,
            commands::execute_application_command,
            commands::execute_component_interaction,
            commands::submit_interaction_modal,
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
            commands::save_secure_token,
            commands::get_secure_token,
            commands::delete_secure_token,
            commands::get_or_create_guild_invite,
            commands::pick_vcc_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VoidCord");

    log::info!("VoidCord application exited");
}
