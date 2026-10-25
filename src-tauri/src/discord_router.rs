//! Discord request routing for explicitly authorized account identities.
//!
//! Callers select an identity for each operation. Permission failures are
//! surfaced unchanged: automatically retrying a denied request with another
//! account would silently change the actor and could bypass channel access
//! restrictions.

use std::{collections::HashMap, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::Duration};

use futures_util::{SinkExt, StreamExt};
use reqwest::{header, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{watch, Mutex, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

const DISCORD_API: &str = "https://discord.com/api/v10";
const DISCORD_GATEWAY: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_RESUME_WINDOW: Duration = Duration::from_secs(10 * 60);
static CAPTCHA_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

fn redact_sensitive_query(path: &str) -> String {
    let Some((route, query)) = path.split_once('?') else {
        return path.to_owned();
    };
    let mut safe_query = Vec::new();
    for parameter in query.split('&') {
        let (key, _) = parameter.split_once('=').unwrap_or((parameter, ""));
        if key == "refresh_token" {
            safe_query.push(format!("{key}=[REDACTED]"));
        } else {
            safe_query.push(parameter.to_owned());
        }
    }
    format!("{route}?{}", safe_query.join("&"))
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptchaChallenge {
    pub request_id: String,
    pub service: String,
    pub site_key: Option<String>,
    pub rq_data: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingCaptchaRequest {
    identity: AccountIdentity,
    method: Method,
    path: String,
    body: Option<Value>,
    rq_token: Option<String>,
    session_id: Option<String>,
    created_at: tokio::time::Instant,
}

/// Distinct credentials configured by the user. Secrets are never serialized.
#[derive(Debug, Clone, Default)]
pub struct TokenManager {
    primary_token: Option<SecretToken>,
    secondary_token: Option<SecretToken>,
    read_only_token: Option<SecretToken>,
}

#[derive(Clone)]
struct SecretToken(Arc<str>);

impl std::fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretToken([REDACTED])")
    }
}

impl TokenManager {
    /// Construct with tokens obtained through a supported OAuth flow.
    pub fn new(
        primary_token: Option<String>,
        secondary_token: Option<String>,
        read_only_token: Option<String>,
    ) -> Self {
        Self {
            primary_token: primary_token.map(|s| SecretToken(Arc::from(s))),
            secondary_token: secondary_token.map(|s| SecretToken(Arc::from(s))),
            read_only_token: read_only_token.map(|s| SecretToken(Arc::from(s))),
        }
    }

    fn get(&self, identity: AccountIdentity) -> Result<&SecretToken, DiscordError> {
        let token = match identity {
            AccountIdentity::Primary => self.primary_token.as_ref(),
            AccountIdentity::Secondary => self.secondary_token.as_ref(),
            AccountIdentity::ReadOnly => self.read_only_token.as_ref(),
        };
        token.ok_or(DiscordError::MissingCredential(identity))
    }
}

/// The account identity is selected by the caller for each request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountIdentity {
    Primary,
    Secondary,
    ReadOnly,
}

/// Permission and HTTP errors are returned to the caller without identity fallback.
#[derive(Debug, thiserror::Error)]
pub enum DiscordError {
    #[error("No credential configured for {0:?} identity")]
    MissingCredential(AccountIdentity),
    #[error("Invalid Discord API path")]
    InvalidPath,
    #[error("Discord returned HTTP {status}: {body}")]
    Http { status: StatusCode, body: String },
    #[error("VOIDCORD_CAPTCHA:{0}")]
    CaptchaRequired(String),
    #[error("Discord request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("WebSocket connection failed: {0}")]
    WebSocket(#[from] tokio_tungstenite::tungstenite::Error),
    #[error("WebSocket URL is invalid")]
    InvalidWebSocketUrl,
    #[error("Discord WebSocket closed")]
    WebSocketClosed,
    #[error("Could not serialize gateway payload: {0}")]
    Serialize(#[from] serde_json::Error),
}

#[derive(Debug, Deserialize)]
struct DiscordErrorBody {
    message: Option<String>,
    code: Option<i64>,
}

#[derive(Debug, Default, Clone)]
struct GatewaySession {
    session_id: Option<String>,
    resume_gateway_url: Option<String>,
    sequence: Option<u64>,
    disconnected_at: Option<tokio::time::Instant>,
    resumable: bool,
}

/// A small, clonable router to share between Tauri commands and gateway tasks.
#[derive(Clone)]
pub struct DiscordRouter {
    client: reqwest::Client,
    tokens: Arc<RwLock<TokenManager>>,
    pending_captchas: Arc<RwLock<HashMap<String, PendingCaptchaRequest>>>,
    gateway_sender: Arc<RwLock<Option<watch::Sender<Value>>>>,
    gateway_session: Arc<Mutex<GatewaySession>>,
}

impl Default for DiscordRouter {
    fn default() -> Self {
        Self::new(TokenManager::default())
    }
}

impl DiscordRouter {
    pub fn new(tokens: TokenManager) -> Self {
        use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};

        let mut headers = HeaderMap::new();
        // Match the Chrome property you use in your gateway loop!
        headers.insert(
            USER_AGENT, 
            HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        );

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            tokens: Arc::new(RwLock::new(tokens)),
            pending_captchas: Arc::new(RwLock::new(HashMap::new())),
            gateway_sender: Arc::new(RwLock::new(None)),
            gateway_session: Arc::new(Mutex::new(GatewaySession::default())),
        }
    }

    /// Replace the active account credentials after an OAuth flow completes.
    pub async fn update_tokens(&self, tokens: TokenManager) {
        *self.tokens.write().await = tokens;
    }

    pub async fn send_gateway_payload(&self, payload: Value) -> Result<(), DiscordError> {
        let sender = self.gateway_sender.read().await;
        let Some(sender) = sender.as_ref() else {
            return Err(DiscordError::Http {
                status: StatusCode::SERVICE_UNAVAILABLE,
                body: "Discord gateway is not connected yet".to_owned(),
            });
        };
        sender.send_replace(payload);
        Ok(())
    }

    /// Issue one REST request using exactly the identity selected by the caller.
    pub async fn rest(
        &self,
        identity: AccountIdentity,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, DiscordError> {
        let path = path.trim_start_matches('/');
        if path.contains("..") || path.starts_with("http") {
            return Err(DiscordError::InvalidPath);
        }
        self.perform_rest(identity, method, path.to_owned(), body, None).await
    }

    /// Upload attachments and send a message with the explicitly selected account.
    pub async fn send_message_with_files(
        &self,
        identity: AccountIdentity,
        channel_id: &str,
        content: &str,
        files: Vec<std::path::PathBuf>,
        reply_to_message_id: Option<&str>,
    ) -> Result<Value, DiscordError> {
        if channel_id.is_empty() || channel_id.chars().any(|c| !c.is_ascii_digit()) {
            return Err(DiscordError::InvalidPath);
        }
        if files.is_empty() || files.len() > 10 {
            return Err(DiscordError::Http { status: StatusCode::BAD_REQUEST, body: "Choose between 1 and 10 files".to_owned() });
        }
        let token = {
            let tokens = self.tokens.read().await;
            tokens.get(identity)?.clone()
        };
        // Ask Discord for the current identity's tier. The backend repeats this
        // check at send time; UI supplied tier values are never trusted.
        let account_response = self.client.get(format!("{DISCORD_API}/users/@me"))
            .header(header::AUTHORIZATION, token.0.as_ref()).send().await?;
        let account_status = account_response.status();
        let account: Value = account_response.json().await?;
        if !account_status.is_success() {
            return Err(DiscordError::Http { status: account_status, body: account.get("message").and_then(Value::as_str).unwrap_or("Could not verify account upload tier").to_owned() });
        }
        let premium_type = account.get("premium_type").and_then(Value::as_u64).unwrap_or(0);
        let size_limit: u64 = match premium_type {
            2 => 500 * 1024 * 1024,
            1 | 3 => 50 * 1024 * 1024,
            _ => 20 * 1024 * 1024,
        };
        let mut payload_json = serde_json::json!({ "content": content });
        if let Some(message_id) = reply_to_message_id {
            if message_id.is_empty() || message_id.chars().any(|c| !c.is_ascii_digit()) {
                return Err(DiscordError::InvalidPath);
            }
            payload_json["message_reference"] = serde_json::json!({
                "message_id": message_id,
                "channel_id": channel_id,
                "fail_if_not_exists": false
            });
        }
        let mut form = reqwest::multipart::Form::new()
            .text("payload_json", payload_json.to_string());
        let mut total_size = 0u64;
        for (index, file_path) in files.into_iter().enumerate() {
            let metadata = tokio::fs::metadata(&file_path).await.map_err(|error| DiscordError::Http { status: StatusCode::BAD_REQUEST, body: format!("Could not read selected attachment: {error}") })?;
            if !metadata.is_file() {
                return Err(DiscordError::Http { status: StatusCode::BAD_REQUEST, body: "An attachment path is not a file".to_owned() });
            }
            let file_size = metadata.len();
            if file_size > size_limit {
                return Err(DiscordError::Http { status: StatusCode::PAYLOAD_TOO_LARGE, body: format!("This account's upload tier allows files up to {} MiB", size_limit / (1024 * 1024)) });
            }
            total_size = total_size.saturating_add(file_size);
            if total_size > size_limit {
                return Err(DiscordError::Http { status: StatusCode::PAYLOAD_TOO_LARGE, body: format!("Attachments exceed this account's {} MiB per-message upload allowance", size_limit / (1024 * 1024)) });
            }
            let filename = file_path.file_name().and_then(|name| name.to_str()).unwrap_or("attachment").chars()
                .filter(|c| !c.is_control() && *c != '/' && *c != '\\').take(180).collect::<String>();
            let file = tokio::fs::File::open(&file_path).await.map_err(|error| DiscordError::Http { status: StatusCode::BAD_REQUEST, body: format!("Could not open selected attachment: {error}") })?;
            let stream = tokio_util::io::ReaderStream::new(file);
            let body = reqwest::Body::wrap_stream(stream);
            let part = reqwest::multipart::Part::stream_with_length(body, file_size).file_name(filename);
            form = form.part(format!("files[{index}]"), part);
        }
        let response = self.client
            .post(format!("{DISCORD_API}/channels/{channel_id}/messages"))
            .header(header::AUTHORIZATION, token.0.as_ref())
            .multipart(form)
            .send().await?;
        let status = response.status();
        let bytes = response.bytes().await?;
        if !status.is_success() {
            let detail = serde_json::from_slice::<DiscordErrorBody>(&bytes)
                .map(|error| format!("{} (Discord code {:?})", error.message.unwrap_or_default(), error.code))
                .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
            return Err(DiscordError::Http { status, body: detail });
        }
        if bytes.is_empty() { return Ok(Value::Null); }
        Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    pub async fn retry_captcha(
        &self,
        request_id: &str,
        captcha_key: &str,
    ) -> Result<Value, DiscordError> {
        if captcha_key.trim().is_empty() {
            return Err(DiscordError::Http { status: StatusCode::BAD_REQUEST, body: "A CAPTCHA response is required".to_owned() });
        }
        let pending = self.pending_captchas.write().await.remove(request_id)
            .ok_or_else(|| DiscordError::Http {
                status: StatusCode::GONE,
                body: "This CAPTCHA request expired. Please repeat the original action.".to_owned(),
            })?;
        if pending.created_at.elapsed() > Duration::from_secs(300) {
            return Err(DiscordError::Http {
                status: StatusCode::GONE,
                body: "This CAPTCHA request expired. Please repeat the original action.".to_owned(),
            });
        }
        self.perform_rest(
            pending.identity,
            pending.method,
            pending.path,
            pending.body,
            Some((captcha_key.to_owned(), pending.rq_token, pending.session_id)),
        ).await
    }

    async fn perform_rest(
        &self,
        identity: AccountIdentity,
        method: Method,
        path: String,
        body: Option<Value>,
        captcha: Option<(String, Option<String>, Option<String>)>,
    ) -> Result<Value, DiscordError> {
        let log_path = redact_sensitive_query(&path);
        log::debug!("Discord REST request: {} {}", method, log_path);
        let token = {
            let tokens = self.tokens.read().await;
            tokens.get(identity)?.clone()
        };
        // Internal endpoints observed on API v9 can opt in with the "api-v9/" route prefix.
        // Strip the marker before sending so it never becomes part of the URL path.
        let (api_base, request_path) = if let Some(route) = path.strip_prefix("api-v9/") {
            ("https://discord.com/api/v9", route)
        } else {
            (DISCORD_API, path.as_str())
        };
        let mut request = self.client.request(method.clone(), format!("{api_base}/{request_path}"))
            .header(header::AUTHORIZATION, token.0.as_ref());
        if let Some((captcha_key, rq_token, session_id)) = &captcha {
            request = request.header("X-Captcha-Key", captcha_key);
            if let Some(rq_token) = rq_token { request = request.header("X-Captcha-Rqtoken", rq_token); }
            if let Some(session_id) = session_id { request = request.header("X-Captcha-Session-Id", session_id); }
        }
        if let Some(json) = &body {
            request = request.json(json);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                log::warn!("Discord REST transport error: {} {} ({})", method, log_path, error);
                return Err(DiscordError::from(error));
            }
        };
        let status = response.status();
        log::debug!("Discord REST response: {} {} -> {}", method, log_path, status);
        let captcha_headers = (
            response.headers().get("captcha-sitekey").and_then(|value| value.to_str().ok()).map(str::to_owned),
            response.headers().get("captcha-rqdata").and_then(|value| value.to_str().ok()).map(str::to_owned),
            response.headers().get("captcha-rqtoken").and_then(|value| value.to_str().ok()).map(str::to_owned),
            response.headers().get("captcha-session-id").and_then(|value| value.to_str().ok()).map(str::to_owned),
            response.headers().get("captcha-service").and_then(|value| value.to_str().ok()).map(str::to_owned),
        );
        let bytes = response.bytes().await?;
        if !status.is_success() {
            let response_json = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
            let site_key = response_json.get("captcha_sitekey").and_then(Value::as_str)
                .map(str::to_owned).or(captcha_headers.0);
            let rq_data = response_json.get("captcha_rqdata").and_then(Value::as_str)
                .map(str::to_owned).or(captcha_headers.1);
            let rq_token = response_json.get("captcha_rqtoken").and_then(Value::as_str)
                .map(str::to_owned).or(captcha_headers.2);
            let session_id = response_json.get("captcha_session_id").and_then(Value::as_str)
                .map(str::to_owned).or(captcha_headers.3);
            let service = response_json.get("captcha_service").and_then(Value::as_str)
                .map(str::to_owned).or(captcha_headers.4)
                .unwrap_or_else(|| "hcaptcha".to_owned());
            if site_key.is_some() {
                let request_id = format!("captcha-{}", CAPTCHA_REQUEST_ID.fetch_add(1, Ordering::Relaxed));
                let pending = PendingCaptchaRequest {
                    identity,
                    method,
                    path,
                    body,
                    rq_token,
                    session_id,
                    created_at: tokio::time::Instant::now(),
                };
                let mut pending_requests = self.pending_captchas.write().await;
                pending_requests.retain(|_, request| request.created_at.elapsed() <= Duration::from_secs(300));
                pending_requests.insert(request_id.clone(), pending);
                let challenge = CaptchaChallenge { request_id, service, site_key, rq_data };
                return Err(DiscordError::CaptchaRequired(serde_json::to_string(&challenge)?));
            }
            log::warn!("Discord REST request rejected: {} {} -> {}", method, log_path, status);
            let body = serde_json::from_slice::<DiscordErrorBody>(&bytes)
                .map(|e| format!("{} (Discord code {:?})", e.message.unwrap_or_default(), e.code))
                .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
            return Err(DiscordError::Http { status, body });
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    /// Open a gateway connection as a specifically selected authorized account.
    /// Retain session state between calls so the caller's retry loop can Resume.
    pub async fn listen_gateway<F>(
        &self,
        identity: AccountIdentity,
        on_event: F,
    ) -> Result<(), DiscordError>
    where
        F: FnMut(Value) + Send,
    {
        let result = self.listen_gateway_once(identity, on_event).await;
        let mut session = self.gateway_session.lock().await;
        if session.session_id.is_some() {
            session.disconnected_at = Some(tokio::time::Instant::now());
        }
        result
    }

    async fn listen_gateway_once<F>(
        &self,
        identity: AccountIdentity,
        mut on_event: F,
    ) -> Result<(), DiscordError>
    where
        F: FnMut(Value) + Send,
    {
        let token = {
            let tokens = self.tokens.read().await;
            tokens.get(identity)?.clone()
        };
        *self.gateway_sender.write().await = None;

        // Do not repeatedly attempt WebSocket connects while offline. Any HTTP
        // response from Discord (including an error status) proves reachability.
        loop {
            match self.client
                .get(format!("{DISCORD_API}/gateway"))
                .timeout(Duration::from_secs(3))
                .send()
                .await
            {
                Ok(_) => break,
                Err(error) => {
                    log::debug!("Discord is not reachable yet; waiting before gateway connect: {error}");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }

        let (connect_url, should_resume) = {
            let mut session = self.gateway_session.lock().await;
            let within_window = session.disconnected_at
                .is_some_and(|at| at.elapsed() < GATEWAY_RESUME_WINDOW);
            let can_resume = session.resumable
                && within_window
                && session.session_id.is_some()
                && session.resume_gateway_url.is_some()
                && session.sequence.is_some();
            if !within_window && session.disconnected_at.is_some() {
                *session = GatewaySession::default();
            }
            let raw_url = if can_resume {
                session.resume_gateway_url.as_deref().unwrap_or(DISCORD_GATEWAY)
            } else {
                DISCORD_GATEWAY
            };
            let mut parsed = url::Url::parse(raw_url).map_err(|_| DiscordError::InvalidWebSocketUrl)?;
            parsed.query_pairs_mut().append_pair("v", "10").append_pair("encoding", "json");
            (parsed.to_string(), can_resume)
        };

        let (mut socket, _) = match connect_async(connect_url.as_str()).await {
            Ok(res) => res,
            Err(e) => {
                log::warn!("Gateway connection failed: {e}");
                return Err(DiscordError::WebSocket(e));
            }
        };

        let (gateway_tx, mut gateway_rx) = watch::channel(Value::Null);
        let mut pending_member_request: Option<Value> = None;
        let mut next_member_request_at = tokio::time::Instant::now();
        let mut heartbeat_interval: Option<Duration> = None;
        let mut heartbeat = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(86_400),
            Duration::from_secs(86_400),
        );
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut identified = false;
        let mut sequence = self.gateway_session.lock().await.sequence;

        loop {
            tokio::select! {
                gateway_payload = gateway_rx.changed() => {
                    if gateway_payload.is_err() {
                        return Err(DiscordError::WebSocketClosed);
                    }
                    let payload = gateway_rx.borrow_and_update().clone();
                    if payload.is_null() {
                        continue;
                    }
                    if payload.get("op").and_then(Value::as_u64) == Some(14) {
                        pending_member_request = Some(payload);
                    } else {
                        if let Err(e) = socket.send(WsMessage::Text(payload.to_string())).await {
                            log::warn!("Gateway send error: {e}");
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep_until(next_member_request_at), if pending_member_request.is_some() => {
                    if let Some(payload) = pending_member_request.take() {
                        if let Err(e) = socket.send(WsMessage::Text(payload.to_string())).await {
                            log::warn!("Gateway member request send error: {e}");
                            break;
                        }
                        next_member_request_at = tokio::time::Instant::now() + Duration::from_secs(2);
                    }
                }
                _ = heartbeat.tick(), if heartbeat_interval.is_some() => {
                    let payload = serde_json::json!({"op": 1, "d": sequence});
                    if let Err(e) = socket.send(WsMessage::Text(payload.to_string())).await {
                        log::warn!("Gateway heartbeat send error: {e}");
                        break;
                    }
                }
                message = socket.next() => {
                    let Some(message_result) = message else {
                        return Err(DiscordError::WebSocketClosed);
                    };

                    // Prevent freezing or crashing on malformed frames
                    let ws_msg = match message_result {
                        Ok(m) => m,
                        Err(e) => {
                            log::warn!("Gateway WebSocket frame error (recovering): {e}");
                            continue;
                        }
                    };

                    match ws_msg {
                        WsMessage::Text(text) => {
                            let event: Value = match serde_json::from_str(&text) {
                                Ok(v) => v,
                                Err(e) => {
                                    log::warn!("Gateway JSON parse error: {e}");
                                    continue;
                                }
                            };

                            let op = event.get("op").and_then(Value::as_u64);
                            if let Some(seq) = event.get("s").and_then(Value::as_u64) {
                                sequence = Some(seq);
                            }

                            if op == Some(10) {
                                if let Some(ms) = event.pointer("/d/heartbeat_interval").and_then(Value::as_u64) {
                                    let interval = Duration::from_millis(ms);
                                    heartbeat_interval = Some(interval);
                                    heartbeat = tokio::time::interval_at(
                                        tokio::time::Instant::now() + interval,
                                        interval,
                                    );
                                    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                                }

                                if !identified {
                                    let handshake = if should_resume {
                                        let session = self.gateway_session.lock().await;
                                        serde_json::json!({
                                            "op": 6,
                                            "d": {
                                                "token": token.0.as_ref(),
                                                "session_id": session.session_id,
                                                "seq": sequence
                                            }
                                        })
                                    } else {
                                        serde_json::json!({
                                            "op": 2,
                                            "d": {
                                                "token": token.0.as_ref(),
                                                "capabilities": 176421,
                                                "properties": {
                                                    "os": "Windows",
                                                    "browser": "Chrome",
                                                    "device": "",
                                                    "system_locale": "en-US",
                                                    "client_version": "1.0.9000",
                                                    "release_channel": "stable"
                                                }
                                            }
                                        })
                                    };
                                    if let Err(e) = socket.send(WsMessage::Text(handshake.to_string())).await {
                                        log::warn!("Gateway handshake send error: {e}");
                                        break;
                                    }
                                    identified = true;
                                }
                            }

                            if op == Some(1) {
                                let payload = serde_json::json!({"op": 1, "d": sequence});
                                let _ = socket.send(WsMessage::Text(payload.to_string())).await;
                            } else if op == Some(7) {
                                // Discord explicitly asks us to reconnect and resume.
                                return Err(DiscordError::WebSocketClosed);
                            } else if op == Some(9) {
                                let resumable = event.get("d").and_then(Value::as_bool).unwrap_or(false);
                                let mut session = self.gateway_session.lock().await;
                                session.resumable = resumable;
                                if !resumable {
                                    *session = GatewaySession::default();
                                }
                                return Err(DiscordError::WebSocketClosed);
                            }

                            if event.get("t").and_then(Value::as_str) == Some("READY") {
                                let d = event.get("d").cloned().unwrap_or(Value::Null);
                                let mut session = self.gateway_session.lock().await;
                                session.session_id = d.get("session_id").and_then(Value::as_str).map(str::to_owned);
                                session.resume_gateway_url = d.get("resume_gateway_url").and_then(Value::as_str).map(str::to_owned);
                                session.sequence = sequence;
                                session.disconnected_at = None;
                                session.resumable = session.session_id.is_some() && session.resume_gateway_url.is_some();
                                *self.gateway_sender.write().await = Some(gateway_tx.clone());
                            } else if event.get("t").and_then(Value::as_str) == Some("RESUMED") {
                                let mut session = self.gateway_session.lock().await;
                                session.sequence = sequence;
                                session.disconnected_at = None;
                                session.resumable = true;
                                *self.gateway_sender.write().await = Some(gateway_tx.clone());
                            }

                            if let Some(seq) = sequence {
                                self.gateway_session.lock().await.sequence = Some(seq);
                            }

                            on_event(event);
                        }
                        WsMessage::Ping(payload) => {
                            let _ = socket.send(WsMessage::Pong(payload)).await;
                        }
                        WsMessage::Close(frame) => {
                            log::info!("Gateway WebSocket closed: {frame:?}");
                            return Err(DiscordError::WebSocketClosed);
                        }
                        _ => {}
                    }
                }
            }
        }
        Err(DiscordError::WebSocketClosed)
    }
}

/// UI-neutral request intents map all message/reaction writes to the primary
/// identity and browsing/event listening to the read-only identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestIntent {
    Browse,
    Listen,
    SendMessage,
    AddReaction,
    RemoveReaction,
}

impl RequestIntent {
    pub const fn identity(self) -> AccountIdentity {
        match self {
            Self::Browse | Self::Listen => AccountIdentity::ReadOnly,
            Self::SendMessage | Self::AddReaction | Self::RemoveReaction => AccountIdentity::Primary,
        }
    }
}

/// Optional local routing policy for communities.
#[derive(Default, Clone)]
pub struct CommunityAccountPreferences {
    by_community: Arc<RwLock<HashMap<String, AccountIdentity>>>,
}

impl CommunityAccountPreferences {
    pub async fn set(&self, community_id: String, identity: AccountIdentity) {
        self.by_community.write().await.insert(community_id, identity);
    }

    pub async fn get(&self, community_id: &str) -> Option<AccountIdentity> {
        self.by_community.read().await.get(community_id).copied()
    }
}

/// Settings can be persisted without ever serializing tokens.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SafeAccountSettings {
    pub primary_account_label: Option<String>,
    pub secondary_account_label: Option<String>,
    pub read_only_account_label: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_writes_and_reads_to_intended_identity() {
        assert_eq!(RequestIntent::SendMessage.identity(), AccountIdentity::Primary);
        assert_eq!(RequestIntent::AddReaction.identity(), AccountIdentity::Primary);
        assert_eq!(RequestIntent::RemoveReaction.identity(), AccountIdentity::Primary);
        assert_eq!(RequestIntent::Browse.identity(), AccountIdentity::ReadOnly);
        assert_eq!(RequestIntent::Listen.identity(), AccountIdentity::ReadOnly);
    }

    #[test]
    fn token_debug_is_redacted() {
        let token = TokenManager::new(Some("secret-value".into()), None, None);
        let printed = format!("{token:?}");
        assert!(!printed.contains("secret-value"));
        assert!(printed.contains("REDACTED"));
    }
}
