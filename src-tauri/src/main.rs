#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discord_router;
mod settings_proto;
mod settings_menu;
mod voice_gateway;

use discord_router::DiscordRouter;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use voice_gateway::VoiceControlState;

struct BackendLogger;

impl log::Log for BackendLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &log::Record<'_>) {
        if self.enabled(record.metadata()) {
            eprintln!("[{}] {}: {}", record.level(), record.target(), record.args());
        }
    }

    fn flush(&self) {}
}

static BACKEND_LOGGER: BackendLogger = BackendLogger;

/// Shared app state — the router and the stored token.
pub struct AppState {
    pub router: DiscordRouter,
    pub token: Arc<Mutex<Option<String>>>,
    pub selected_uploads: Mutex<HashMap<String, (tokio::time::Instant, Vec<PathBuf>)>>,
    pub gateway_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub voice_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub voice_controls: VoiceControlState,
}

fn main() {
    log::set_logger(&BACKEND_LOGGER).expect("failed to initialize Rust backend logger");
    log::set_max_level(if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    });
    log::info!("VoidCord Rust backend starting (debug_assertions={})", cfg!(debug_assertions));

    let app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    // Conditionally add devtools plugin in debug mode without making builder mutable
    #[cfg(debug_assertions)]
    let app_builder = app_builder.plugin(tauri_plugin_devtools::init());

    app_builder
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
            commands::create_dm,
            commands::add_friend,
            commands::update_relationship,
            commands::set_presence,
            commands::update_bio,
            commands::get_current_user_settings,
            commands::sync_settings_proto_v1,
            settings_menu::save_client_settings,
            commands::get_user_profile,
            commands::get_channels,
            commands::get_messages,
            commands::archive_message_media,
            commands::send_message,
            commands::send_message_with_files,
            commands::search_application_commands,
            commands::get_global_application_commands,
            commands::get_guild_application_commands,
            commands::get_guild_application_command_permissions,
            commands::execute_application_command,
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VoidCord");

    log::info!("VoidCord application exited");
}
