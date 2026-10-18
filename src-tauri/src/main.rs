#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod discord_router;

use discord_router::DiscordRouter;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared app state — the router and the stored token.
pub struct AppState {
    pub router: DiscordRouter,
    pub token: Arc<Mutex<Option<String>>>,
}

fn main() {
    let app_builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build());

    // Conditionally add devtools plugin in debug mode without making builder mutable
    #[cfg(debug_assertions)]
    let app_builder = app_builder.plugin(tauri_plugin_devtools::init());

    app_builder
        .manage(AppState {
            router: DiscordRouter::default(),
            token: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_token,
            commands::get_current_user,
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
            commands::get_current_user_settings,
            commands::get_user_profile,
            commands::get_channels,
            commands::get_messages,
            commands::archive_message_media,
            commands::send_message,
            commands::forward_message,
            commands::edit_message,
            commands::delete_message,
            commands::moderate_guild_member,
            commands::set_guild_member_nickname,
            commands::update_guild_channel,
            commands::set_guild_channel_locked,
            commands::delete_guild_channel,
            commands::start_gateway,
            commands::toggle_devtools,
            commands::request_guild_member_list,
            commands::get_guild_roles,
            commands::get_current_guild_member,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run VoidCord");
}