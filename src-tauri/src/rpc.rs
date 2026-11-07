use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

use reqwest::Method;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{watch, Mutex},
    task::JoinHandle,
};

use crate::{
    discord_router::{AccountIdentity, DiscordRouter},
    AppState,
};

const MAX_RPC_PACKET_SIZE: usize = 1024 * 1024;
const MAX_RPC_CLIENTS: usize = 32;
static NEXT_ACTIVITY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct PresenceSnapshot {
    status: String,
    custom_status: Option<String>,
    process_game: Option<String>,
    custom_rpc_activity: Option<Value>,
    rpc_activities: HashMap<String, (u64, Value)>,
}

impl PresenceSnapshot {
    fn gateway_payload(&self) -> Value {
        let mut activities = Vec::new();
        if let Some(text) = self
            .custom_status
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            activities.push(json!({
                "name": "Custom Status",
                "type": 4,
                "state": text
            }));
        }
        let rpc_activity = self
            .rpc_activities
            .values()
            .max_by_key(|(sequence, _)| sequence)
            .map(|(_, activity)| activity);
        if let Some(activity) = rpc_activity {
            activities.push(activity.clone());
        } else if let Some(activity) = self.custom_rpc_activity.as_ref() {
            activities.push(activity.clone());
        } else if let Some(game_name) = self.process_game.as_deref() {
            activities.push(json!({
                "name": game_name,
                "type": 0
            }));
        }
        json!({
            "op": 3,
            "d": {
                "since": null,
                "activities": activities,
                "status": if self.status.is_empty() { "online" } else { &self.status },
                "afk": false
            }
        })
    }

    fn has_game_activity(&self) -> bool {
        !self.rpc_activities.is_empty()
            || self.custom_rpc_activity.is_some()
            || self.process_game.is_some()
    }
}

struct RunningListener {
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

#[derive(Default)]
pub struct RpcState {
    listener: Mutex<Option<RunningListener>>,
    presence: Mutex<PresenceSnapshot>,
    connected_clients: Arc<AtomicUsize>,
}

impl RpcState {
    async fn publish(&self, router: &DiscordRouter) -> Result<(), String> {
        let payload = self.presence.lock().await.gateway_payload();
        router
            .send_gateway_payload(payload)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn set_process_activity(
        &self,
        router: &DiscordRouter,
        game_name: Option<String>,
        status: &str,
        custom_status: Option<&str>,
    ) -> Result<(), String> {
        {
            let mut presence = self.presence.lock().await;
            presence.process_game = game_name;
            presence.status = status.to_owned();
            presence.custom_status = custom_status
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned);
        }
        self.publish(router).await
    }

    pub async fn update_base_presence(
        &self,
        router: &DiscordRouter,
        status: &str,
        custom_status: Option<&str>,
    ) -> Result<(), String> {
        let has_game_activity = {
            let mut presence = self.presence.lock().await;
            presence.status = status.to_owned();
            presence.custom_status = custom_status
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned);
            presence.has_game_activity()
        };
        if has_game_activity {
            self.publish(router).await?;
        }
        Ok(())
    }

    pub async fn set_custom_rpc_activity(
        &self,
        router: &DiscordRouter,
        activity: Option<Value>,
        status: &str,
        custom_status: Option<&str>,
    ) -> Result<(), String> {
        {
            let mut presence = self.presence.lock().await;
            presence.custom_rpc_activity = activity;
            presence.status = status.to_owned();
            presence.custom_status = custom_status
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned);
        }
        self.publish(router).await
    }

    async fn set_rpc_activity(
        &self,
        router: &DiscordRouter,
        connection_id: String,
        activity: Option<Value>,
    ) -> Result<(), String> {
        {
            let mut presence = self.presence.lock().await;
            if let Some(activity) = activity {
                presence.rpc_activities.insert(
                    connection_id,
                    (
                        NEXT_ACTIVITY_SEQUENCE.fetch_add(1, Ordering::Relaxed),
                        activity,
                    ),
                );
            } else {
                presence.rpc_activities.remove(&connection_id);
            }
        }
        if let Err(error) = self.publish(router).await {
            log::warn!("Game RPC activity queued but could not be sent to the Gateway: {error}");
        }
        Ok(())
    }

    pub async fn republish(&self, router: &DiscordRouter) -> Result<(), String> {
        if self.presence.lock().await.has_game_activity() {
            self.publish(router).await?;
        }
        Ok(())
    }

    pub async fn set_listener_enabled(
        &self,
        app: AppHandle,
        enabled: bool,
        status: &str,
        custom_status: Option<&str>,
    ) -> Result<(), String> {
        {
            let mut presence = self.presence.lock().await;
            presence.status = status.to_owned();
            presence.custom_status = custom_status
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned);
        }
        let mut listener = self.listener.lock().await;
        if enabled {
            if listener.is_some() {
                return Ok(());
            }
            #[cfg(windows)]
            {
                let (shutdown, receiver) = watch::channel(false);
                let app_for_task = app.clone();
                let client_count = self.connected_clients.clone();
                let task = tokio::spawn(async move {
                    run_windows_listener(app_for_task, receiver, client_count).await;
                });
                *listener = Some(RunningListener { shutdown, task });
                let _ = app.emit(
                    "voidcord:rpc-status",
                    json!({ "enabled": true, "connectedClients": self.connected_clients.load(Ordering::Relaxed) }),
                );
                log::info!("Local Discord RPC IPC listener enabled");
                return Ok(());
            }
            #[cfg(not(windows))]
            {
                return Err(
                    "The local RPC listener is currently supported on Windows only".to_owned(),
                );
            }
        }

        let Some(running) = listener.take() else {
            return Ok(());
        };
        let _ = running.shutdown.send(true);
        drop(listener);
        if let Err(error) = running.task.await {
            if !error.is_cancelled() {
                return Err(format!("Could not stop the RPC listener: {error}"));
            }
        }
        let drain_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        while self.connected_clients.load(Ordering::Relaxed) > 0
            && tokio::time::Instant::now() < drain_deadline
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        if self.connected_clients.load(Ordering::Relaxed) > 0 {
            log::warn!("Some local RPC connections did not close within the shutdown window");
        }
        self.presence.lock().await.rpc_activities.clear();
        if let Err(error) = self.publish(&app.state::<AppState>().router).await {
            log::warn!("RPC listener stopped but the cleared presence could not be sent: {error}");
        }
        let _ = app.emit(
            "voidcord:rpc-status",
            json!({ "enabled": false, "connectedClients": 0 }),
        );
        log::info!("Local Discord RPC IPC listener disabled");
        Ok(())
    }
}

fn prepare_rpc_activity(
    client_id: &str,
    activity: Option<&Value>,
) -> Result<Option<Value>, String> {
    let Some(Value::Object(activity)) = activity else {
        return if activity.is_none() || activity == Some(&Value::Null) {
            Ok(None)
        } else {
            Err("Activity must be an object or null".to_owned())
        };
    };
    if serde_json::to_vec(activity)
        .map_err(|error| error.to_string())?
        .len()
        > 64 * 1024
    {
        return Err("Activity payload is too large".to_owned());
    }
    let mut activity = activity.clone();
    activity.insert("application_id".to_owned(), json!(client_id));
    activity.entry("name".to_owned()).or_insert(json!("Game"));
    activity.entry("type".to_owned()).or_insert(json!(0));
    Ok(Some(Value::Object(activity)))
}

#[cfg(windows)]
async fn run_windows_listener(
    app: AppHandle,
    shutdown: watch::Receiver<bool>,
    connected_clients: Arc<AtomicUsize>,
) {
    use tokio::task::JoinSet;

    let mut listeners = JoinSet::new();
    for slot in 0..10 {
        listeners.spawn(listen_on_windows_pipe(
            app.clone(),
            slot,
            shutdown.clone(),
            connected_clients.clone(),
        ));
    }
    let mut shutdown = shutdown;
    let _ = shutdown.changed().await;
    listeners.abort_all();
    while listeners.join_next().await.is_some() {}
}

#[cfg(windows)]
async fn listen_on_windows_pipe(
    app: AppHandle,
    slot: u8,
    mut shutdown: watch::Receiver<bool>,
    connected_clients: Arc<AtomicUsize>,
) {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = format!(r"\\.\pipe\discord-ipc-{slot}");
    loop {
        if *shutdown.borrow() {
            return;
        }
        let pipe = match ServerOptions::new()
            .first_pipe_instance(false)
            .reject_remote_clients(true)
            .create(&pipe_name)
        {
            Ok(pipe) => pipe,
            Err(error) => {
                log::warn!("Could not listen on local RPC pipe {slot}: {error}");
                return;
            }
        };
        tokio::select! {
            result = pipe.connect() => {
                if let Err(error) = result {
                    if !*shutdown.borrow() {
                        log::warn!("Local RPC pipe {slot} connection failed: {error}");
                    }
                    return;
                }
                let active_count = connected_clients.fetch_add(1, Ordering::Relaxed) + 1;
                if active_count > MAX_RPC_CLIENTS {
                    connected_clients.fetch_sub(1, Ordering::Relaxed);
                    log::warn!("Rejected local RPC client: connection limit reached");
                    continue;
                }
                let _ = app.emit(
                    "voidcord:rpc-status",
                    json!({ "enabled": true, "connectedClients": active_count }),
                );
                tokio::spawn(handle_rpc_connection(
                    pipe,
                    app.clone(),
                    shutdown.clone(),
                    connected_clients.clone(),
                    slot,
                ));
            }
            _ = shutdown.changed() => return,
        }
    }
}

#[cfg(windows)]
async fn handle_rpc_connection<P>(
    mut pipe: P,
    app: AppHandle,
    mut shutdown: watch::Receiver<bool>,
    connected_clients: Arc<AtomicUsize>,
    slot: u8,
) where
    P: AsyncRead + AsyncWrite + Unpin,
{
    let connection_id = uuid::Uuid::new_v4().to_string();
    let result = handle_rpc_frames(&mut pipe, &app, &mut shutdown, &connection_id, slot).await;
    if let Err(error) = result {
        log::debug!("Local RPC client on pipe {slot} disconnected: {error}");
    }
    let state = app.state::<AppState>();
    let was_active = state
        .rpc
        .presence
        .lock()
        .await
        .rpc_activities
        .contains_key(&connection_id);
    if was_active {
        if let Err(error) = state
            .rpc
            .set_rpc_activity(&state.router, connection_id, None)
            .await
        {
            log::warn!("Could not clear activity for disconnected RPC client: {error}");
        }
    }
    let remaining = connected_clients
        .fetch_sub(1, Ordering::Relaxed)
        .saturating_sub(1);
    let _ = app.emit(
        "voidcord:rpc-status",
        json!({ "enabled": !*shutdown.borrow(), "connectedClients": remaining }),
    );
}

#[cfg(windows)]
async fn handle_rpc_frames<P>(
    pipe: &mut P,
    app: &AppHandle,
    shutdown: &mut watch::Receiver<bool>,
    connection_id: &str,
    slot: u8,
) -> Result<(), String>
where
    P: AsyncRead + AsyncWrite + Unpin,
{
    let (opcode, payload) = tokio::select! {
        result = read_packet(pipe) => result?,
        _ = shutdown.changed() => return Ok(()),
    };
    if opcode != 0 {
        return Err("RPC handshake packet was not first".to_owned());
    }
    let handshake: Value = serde_json::from_slice(&payload)
        .map_err(|error| format!("Invalid RPC handshake: {error}"))?;
    let version = handshake.get("v").and_then(Value::as_u64);
    let client_id = handshake
        .get("client_id")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty() && value.len() <= 32 && value.bytes().all(|b| b.is_ascii_digit())
        })
        .ok_or_else(|| "RPC handshake requires a numeric application ID".to_owned())?;
    if version != Some(1) {
        return Err(format!("Unsupported RPC protocol version: {version:?}"));
    }

    let state = app.state::<AppState>();
    let user = tokio::select! {
        result = state.router.rest(
            AccountIdentity::ReadOnly,
            Method::GET,
            "users/@me",
            None,
        ) => result.map_err(|error| format!("RPC requires a connected VoidCord account: {error}"))?,
        _ = shutdown.changed() => return Ok(()),
    };
    write_packet(
        pipe,
        1,
        &json!({
            "cmd": "DISPATCH",
            "evt": "READY",
            "data": {
                "v": 1,
                "config": {
                    "api_endpoint": "https://discord.com/api",
                    "cdn_host": "cdn.discordapp.com",
                    "environment": "production"
                },
                "user": user
            }
        }),
    )
    .await?;
    log::info!("Game RPC client connected on pipe {slot} (application={client_id})");

    loop {
        let (opcode, payload) = tokio::select! {
            result = read_packet(pipe) => result?,
            _ = shutdown.changed() => return Ok(()),
        };
        match opcode {
            1 => {
                let message: Value = serde_json::from_slice(&payload)
                    .map_err(|error| format!("Invalid RPC command: {error}"))?;
                tokio::select! {
                    result = process_rpc_command(
                        pipe,
                        app,
                        connection_id,
                        client_id,
                        message,
                    ) => result?,
                    _ = shutdown.changed() => return Ok(()),
                }
            }
            2 => return Ok(()),
            3 => write_packet_bytes(pipe, 4, &payload).await?,
            _ => return Err(format!("Unsupported RPC packet opcode: {opcode}")),
        }
    }
}

#[cfg(windows)]
async fn process_rpc_command<P>(
    pipe: &mut P,
    app: &AppHandle,
    connection_id: &str,
    client_id: &str,
    message: Value,
) -> Result<(), String>
where
    P: AsyncWrite + Unpin,
{
    let command = message
        .get("cmd")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let nonce = message.get("nonce").cloned().unwrap_or(Value::Null);
    let args = message.get("args").cloned().unwrap_or_else(|| json!({}));
    match command {
        "SET_ACTIVITY" => {
            let Some(activity_value) = args.get("activity") else {
                return send_rpc_error(
                    pipe,
                    command,
                    nonce,
                    4000,
                    "SET_ACTIVITY requires an activity field",
                )
                .await;
            };
            let activity = match prepare_rpc_activity(client_id, Some(activity_value)) {
                Ok(activity) => activity,
                Err(error) => return send_rpc_error(pipe, command, nonce, 4000, &error).await,
            };
            let state = app.state::<AppState>();
            if let Err(error) = state
                .rpc
                .set_rpc_activity(&state.router, connection_id.to_owned(), activity)
                .await
            {
                return send_rpc_error(pipe, command, nonce, 1000, &error).await;
            }
            write_packet(
                pipe,
                1,
                &json!({ "cmd": command, "data": {}, "evt": null, "nonce": nonce }),
            )
            .await
        }
        "SUBSCRIBE" | "UNSUBSCRIBE" => {
            send_rpc_error(
                pipe,
                command,
                nonce,
                4004,
                "RPC event subscriptions are not supported",
            )
            .await
        }
        _ => send_rpc_error(pipe, command, nonce, 4002, "Unsupported RPC command").await,
    }
}

#[cfg(windows)]
async fn send_rpc_error<P>(
    pipe: &mut P,
    command: &str,
    nonce: Value,
    code: u64,
    message: &str,
) -> Result<(), String>
where
    P: AsyncWrite + Unpin,
{
    write_packet(
        pipe,
        1,
        &json!({
            "cmd": command,
            "data": { "code": code, "message": message },
            "evt": "ERROR",
            "nonce": nonce
        }),
    )
    .await
}

async fn read_packet<R>(reader: &mut R) -> Result<(u32, Vec<u8>), String>
where
    R: AsyncRead + Unpin,
{
    let mut header = [0u8; 8];
    reader
        .read_exact(&mut header)
        .await
        .map_err(|error| format!("Could not read RPC packet header: {error}"))?;
    let opcode = u32::from_le_bytes(header[..4].try_into().expect("fixed-size header"));
    let length = u32::from_le_bytes(header[4..].try_into().expect("fixed-size header")) as usize;
    if length > MAX_RPC_PACKET_SIZE {
        return Err(format!(
            "RPC packet exceeds the {MAX_RPC_PACKET_SIZE}-byte limit"
        ));
    }
    let mut payload = vec![0; length];
    reader
        .read_exact(&mut payload)
        .await
        .map_err(|error| format!("Could not read RPC packet payload: {error}"))?;
    Ok((opcode, payload))
}

async fn write_packet<W>(writer: &mut W, opcode: u32, payload: &Value) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let bytes = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    write_packet_bytes(writer, opcode, &bytes).await
}

async fn write_packet_bytes<W>(writer: &mut W, opcode: u32, payload: &[u8]) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    if payload.len() > MAX_RPC_PACKET_SIZE {
        return Err(format!(
            "RPC packet exceeds the {MAX_RPC_PACKET_SIZE}-byte limit"
        ));
    }
    writer
        .write_all(&opcode.to_le_bytes())
        .await
        .map_err(|error| format!("Could not write RPC opcode: {error}"))?;
    writer
        .write_all(&(payload.len() as u32).to_le_bytes())
        .await
        .map_err(|error| format!("Could not write RPC packet length: {error}"))?;
    writer
        .write_all(payload)
        .await
        .map_err(|error| format!("Could not write RPC payload: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("Could not flush RPC packet: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[test]
    fn rpc_activity_takes_priority_over_process_fallback_and_preserves_custom_status() {
        let mut presence = PresenceSnapshot {
            status: "dnd".to_owned(),
            custom_status: Some("Busy".to_owned()),
            process_game: Some("Fallback Game".to_owned()),
            ..PresenceSnapshot::default()
        };
        presence.rpc_activities.insert(
            "game".to_owned(),
            (
                1,
                json!({ "name": "SDK Game", "type": 0, "application_id": "123" }),
            ),
        );
        let payload = presence.gateway_payload();
        assert_eq!(payload["d"]["status"], "dnd");
        assert_eq!(payload["d"]["activities"][0]["type"], 4);
        assert_eq!(payload["d"]["activities"][1]["name"], "SDK Game");
        assert_ne!(payload["d"]["activities"][1]["name"], "Fallback Game");
    }

    #[test]
    fn process_game_is_used_when_no_rpc_activity_is_active() {
        let presence = PresenceSnapshot {
            status: "online".to_owned(),
            process_game: Some("Fallback Game".to_owned()),
            ..PresenceSnapshot::default()
        };
        assert_eq!(
            presence.gateway_payload()["d"]["activities"][0]["name"],
            "Fallback Game"
        );
    }

    #[test]
    fn rpc_activity_keeps_rich_presence_fields_and_adds_application_metadata() {
        let activity = json!({
            "details": "In a match",
            "state": "Ranked",
            "timestamps": { "start": 123 },
            "assets": { "large_image": "game-logo" },
            "buttons": [{ "label": "Join", "url": "https://example.com" }]
        });
        let prepared = prepare_rpc_activity("123456789", Some(&activity))
            .unwrap()
            .unwrap();
        assert_eq!(prepared["application_id"], "123456789");
        assert_eq!(prepared["type"], 0);
        assert_eq!(prepared["details"], "In a match");
        assert_eq!(prepared["assets"]["large_image"], "game-logo");
        assert_eq!(prepared["buttons"][0]["label"], "Join");
    }

    #[test]
    fn null_rpc_activity_clears_and_invalid_activity_is_rejected() {
        assert_eq!(
            prepare_rpc_activity("123", Some(&Value::Null)).unwrap(),
            None
        );
        assert!(prepare_rpc_activity("123", Some(&json!("not an object"))).is_err());
    }

    #[tokio::test]
    async fn rpc_frames_use_little_endian_opcode_and_length() {
        let (mut client, mut server) = duplex(128);
        let payload = json!({ "cmd": "SET_ACTIVITY" });
        let write = tokio::spawn(async move {
            write_packet(&mut server, 1, &payload).await.unwrap();
        });
        let (opcode, bytes) = read_packet(&mut client).await.unwrap();
        write.await.unwrap();
        assert_eq!(opcode, 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap()["cmd"],
            "SET_ACTIVITY"
        );
    }

    #[test]
    fn sdk_activity_overrides_manual_custom_rpc_and_process_fallback() {
        let mut presence = PresenceSnapshot {
            process_game: Some("Process Game".to_owned()),
            custom_rpc_activity: Some(json!({ "name": "Manual Game", "type": 0 })),
            ..PresenceSnapshot::default()
        };
        presence.rpc_activities.insert(
            "sdk".to_owned(),
            (1, json!({ "name": "SDK Game", "type": 0 })),
        );
        assert_eq!(
            presence.gateway_payload()["d"]["activities"][0]["name"],
            "SDK Game"
        );
    }

    #[test]
    fn manual_custom_rpc_activity_overrides_process_fallback() {
        let presence = PresenceSnapshot {
            process_game: Some("Process Game".to_owned()),
            custom_rpc_activity: Some(json!({ "name": "Manual Game", "type": 0 })),
            ..PresenceSnapshot::default()
        };
        assert_eq!(
            presence.gateway_payload()["d"]["activities"][0]["name"],
            "Manual Game"
        );
    }
}
