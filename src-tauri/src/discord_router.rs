//! Discord request routing for explicitly authorized account identities.
//!
//! Callers select an identity for each operation. Permission failures are
//! surfaced unchanged: automatically retrying a denied request with another
//! account would silently change the actor and could bypass channel access
//! restrictions.

use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock as StdRwLock,
    },
    time::Duration,
};

use futures_util::{SinkExt, StreamExt};
use reqwest::{header, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{watch, Mutex, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

const DISCORD_API: &str = "https://discord.com/api/v10";
const DISCORD_GATEWAY: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_RESUME_WINDOW: Duration = Duration::from_secs(10 * 60);
const ACCOUNT_HEALTH_TTL: Duration = Duration::from_secs(60 * 2);
const UNAVAILABLE_ACCOUNT_TTL: Duration = Duration::from_secs(60 * 5);
const BOT_GATEWAY_INTENTS: u64 = (1 << 0) | (1 << 7) | (1 << 9) | (1 << 10) | (1 << 12) | (1 << 13);
static CAPTCHA_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
const MAX_RATE_LIMIT_RETRIES: usize = 5;

#[derive(Clone, Copy)]
struct CachedCredentialHealth {
    available: bool,
    checked_at: tokio::time::Instant,
}

#[derive(Clone)]
struct ClientEnvironment {
    locale: String,
    timezone: String,
    launch_id: uuid::Uuid,
    installation_id: Arc<StdRwLock<Option<String>>>,
    installation_id_path: Option<PathBuf>,
}

impl ClientEnvironment {
    fn detect(installation_id_path: Option<PathBuf>) -> Self {
        let locale = std::env::var("LC_ALL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                std::env::var("LC_MESSAGES")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                std::env::var("LANG")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(system_locale)
            .map(|value| normalize_locale(&value))
            .unwrap_or_else(|| "en-US".to_owned());
        let timezone = iana_time_zone::get_timezone().unwrap_or_else(|error| {
            log::warn!("Could not detect system time zone for Discord headers: {error}");
            "UTC".to_owned()
        });
        let installation_id =
            installation_id_path
                .as_ref()
                .and_then(|path| match std::fs::read_to_string(path) {
                    Ok(value) => match normalize_installation_id(&value) {
                        Some(value) => Some(value),
                        None => {
                            log::warn!(
                                "Stored Discord installation ID is invalid; awaiting a new one"
                            );
                            None
                        }
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                    Err(error) => {
                        log::warn!("Could not read the Discord installation ID: {error}");
                        None
                    }
                });
        Self {
            locale,
            timezone,
            launch_id: uuid::Uuid::new_v4(),
            installation_id: Arc::new(StdRwLock::new(installation_id)),
            installation_id_path,
        }
    }

    fn super_properties(&self) -> Value {
        serde_json::json!({
            "os": if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "Mac OS X" } else { "Linux" },
            "browser": "Chrome",
            "device": "",
            "system_locale": self.locale,
            "browser_user_agent": CHROME_USER_AGENT,
            "browser_version": CHROME_VERSION,
            "app_arch": discord_architecture(),
            "os_version": "",
            "referrer": "",
            "referring_domain": "",
            "referrer_current": "",
            "referring_domain_current": "",
            "release_channel": "stable",
            "client_build_number": 657850,
            "client_event_source": null,
            "client_launch_id": self.launch_id.to_string()
        })
    }

    fn gateway_properties(&self) -> Value {
        let mut properties = self.super_properties();
        if let Some(installation_id) = self.installation_id() {
            properties["installation_id"] = Value::String(installation_id);
        }
        properties
    }

    fn installation_id(&self) -> Option<String> {
        match self.installation_id.read() {
            Ok(value) => value.clone(),
            Err(error) => {
                log::error!("Discord installation ID lock poisoned: {error}");
                None
            }
        }
    }

    fn set_installation_id(&self, value: &str) -> Result<(), String> {
        let value = normalize_installation_id(value)
            .ok_or_else(|| "Discord returned an invalid installation ID".to_owned())?;
        {
            let mut current = self
                .installation_id
                .write()
                .map_err(|error| format!("Discord installation ID lock poisoned: {error}"))?;
            *current = Some(value.clone());
        }

        if let Some(path) = &self.installation_id_path {
            std::fs::write(path, value)
                .map_err(|error| format!("Could not persist Discord installation ID: {error}"))?;
        }
        Ok(())
    }
}

fn normalize_installation_id(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= 512
        && value.is_ascii()
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace()))
    .then(|| value.to_owned())
}

fn is_account_access_blocked(error: &DiscordError) -> bool {
    match error {
        DiscordError::Http { status, .. } => {
            *status == StatusCode::UNAUTHORIZED || *status == StatusCode::FORBIDDEN
        }
        DiscordError::CredentialUnavailable => true,
        DiscordError::CaptchaRequired(_) => true,
        _ => false,
    }
}

fn discord_architecture() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "x86",
        architecture => architecture,
    }
}

fn system_locale() -> Option<String> {
    #[cfg(windows)]
    {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt};

        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn GetUserDefaultLocaleName(locale_name: *mut u16, count: i32) -> i32;
        }

        let mut buffer = [0u16; 85];
        let length = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
        if length > 1 {
            return Some(
                OsString::from_wide(&buffer[..(length - 1) as usize])
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = std::process::Command::new("locale").output() {
            if output.status.success() {
                return parse_locale_output(&String::from_utf8_lossy(&output.stdout));
            }
        }
    }

    None
}

#[cfg(not(windows))]
fn parse_locale_output(output: &str) -> Option<String> {
    ["LC_MESSAGES", "LANG"].into_iter().find_map(|key| {
        output.lines().find_map(|line| {
            let (name, value) = line.split_once('=')?;
            let locale = value.trim().trim_matches('"');
            (name == key && !locale.is_empty()).then(|| locale.to_owned())
        })
    })
}

fn normalize_locale(value: &str) -> String {
    let locale = value.split(['.', '@']).next().unwrap_or(value).trim();
    if locale.is_empty() || locale.eq_ignore_ascii_case("c") || locale.eq_ignore_ascii_case("posix")
    {
        return "en-US".to_owned();
    }
    locale.replace('_', "-")
}

#[derive(Default)]
struct RateLimitState {
    global_until: HashMap<u64, tokio::time::Instant>,
    route_until: HashMap<u64, tokio::time::Instant>,
    route_buckets: HashMap<u64, u64>,
}

fn hash_rate_limit_key<T: Hash + ?Sized>(value: &T) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn token_rate_limit_key(token: &SecretToken) -> u64 {
    hash_rate_limit_key(token.0.as_ref())
}

fn route_rate_limit_key(token_key: u64, method: &Method, path: &str) -> u64 {
    hash_rate_limit_key(&(
        token_key,
        method.as_str(),
        path.split('?').next().unwrap_or(path),
    ))
}

fn bucket_rate_limit_key(token_key: u64, bucket: &str, path: &str) -> u64 {
    let segments = path.split('/').collect::<Vec<_>>();
    let mut major_parameters = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if matches!(*segment, "channels" | "guilds" | "webhooks") {
            if let Some(id) = segments.get(index + 1) {
                major_parameters.push(*id);
            }
            if *segment == "webhooks" {
                if let Some(token) = segments.get(index + 2) {
                    major_parameters.push(*token);
                }
            }
        }
    }
    hash_rate_limit_key(&(token_key, bucket, major_parameters))
}

fn parse_retry_after(headers: &header::HeaderMap, body: &Value) -> Option<f64> {
    let header_value = headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0);
    let body_value = body.get("retry_after").and_then(Value::as_f64);
    header_value
        .or(body_value)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
}

fn rate_limit_is_shared(headers: &header::HeaderMap) -> bool {
    headers
        .get("x-ratelimit-scope")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|scope| scope.eq_ignore_ascii_case("shared"))
}

fn rate_limit_is_global(headers: &header::HeaderMap, body: &Value) -> bool {
    headers
        .get("x-ratelimit-global")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
        || headers
            .get("x-ratelimit-scope")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|scope| scope.eq_ignore_ascii_case("global"))
        || body.get("global").and_then(Value::as_bool) == Some(true)
}

fn rate_limit_scope(headers: &header::HeaderMap, global: bool) -> String {
    if global {
        "global".to_owned()
    } else {
        headers
            .get("x-ratelimit-scope")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("user")
            .to_owned()
    }
}

const CHROME_VERSION: &str = "150.0.7871.129";
const CHROME_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.129 Safari/537.36";

fn redact_sensitive_query(path: &str) -> String {
    let Some((route, query)) = path.split_once('?') else {
        return path.to_owned();
    };
    let mut safe_query = Vec::new();
    for parameter in query.split('&') {
        let (key, _) = parameter.split_once('=').unwrap_or((parameter, ""));
        if matches!(
            key.to_ascii_lowercase().as_str(),
            "refresh_token"
                | "token"
                | "access_token"
                | "authorization"
                | "session_id"
                | "code"
                | "password"
        ) {
            safe_query.push(format!("{key}=[REDACTED]"));
        } else {
            safe_query.push(parameter.to_owned());
        }
    }
    format!("{route}?{}", safe_query.join("&"))
}

/// Enable verbose payload logging with VOIDCORD_TRACE_NETWORK=1 before launching.
/// Secrets are recursively redacted and payload output is bounded to avoid log floods.
fn verbose_network_trace() -> bool {
    std::env::var("VOIDCORD_TRACE_NETWORK")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn redact_json(value: &Value) -> Value {
    const SECRET_KEYS: &[&str] = &[
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set-cookie",
        "password",
        "captcha_key",
        "captcha-rqtoken",
        "captcha_rqtoken",
        "captcha_session_id",
        "session_id",
        "secret",
        "client_secret",
    ];
    match value {
        Value::Object(object) => {
            let mut safe = serde_json::Map::new();
            for (key, child) in object {
                if SECRET_KEYS
                    .iter()
                    .any(|secret| key.eq_ignore_ascii_case(secret))
                {
                    safe.insert(key.clone(), Value::String("[REDACTED]".to_owned()));
                } else {
                    safe.insert(key.clone(), redact_json(child));
                }
            }
            Value::Object(safe)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_json).collect()),
        _ => value.clone(),
    }
}

fn trace_payload(label: &str, value: &Value) {
    if !verbose_network_trace() {
        return;
    }
    let shape = match value {
        Value::Object(object) => format!("object with {} fields", object.len()),
        Value::Array(items) => format!("array with {} items", items.len()),
        Value::String(text) => format!("string with {} characters", text.chars().count()),
        Value::Number(_) | Value::Bool(_) => "scalar".to_owned(),
        Value::Null => "null".to_owned(),
    };
    log::debug!("{label} payload omitted ({shape})");
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
pub(crate) struct SecretToken(pub(crate) Arc<str>);

fn bot_token_value(token: &str) -> Option<&str> {
    let (scheme, value) = token.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bot") && !value.trim().is_empty()).then(|| value.trim_start())
}

impl SecretToken {
    fn is_bot(&self) -> bool {
        bot_token_value(self.0.as_ref()).is_some()
    }

    fn gateway_value(&self) -> &str {
        bot_token_value(self.0.as_ref()).unwrap_or(self.0.as_ref())
    }

    fn authorization_value(&self) -> String {
        bot_token_value(self.0.as_ref())
            .map(|value| format!("Bot {value}"))
            .unwrap_or_else(|| self.0.to_string())
    }
}

impl std::fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretToken([REDACTED])")
    }
}

impl TokenManager {
    pub fn new(
        primary_token: Option<String>,
        secondary_token: Option<String>,
        read_only_token: Option<String>,
    ) -> Self {
        Self {
            primary_token: primary_token
                .filter(|s| !s.trim().is_empty())
                .map(|s| SecretToken(Arc::from(s))),
            secondary_token: secondary_token
                .filter(|s| !s.trim().is_empty())
                .map(|s| SecretToken(Arc::from(s))),
            read_only_token: read_only_token
                .filter(|s| !s.trim().is_empty())
                .map(|s| SecretToken(Arc::from(s))),
        }
    }

    pub(crate) fn candidate_tokens(&self, identity: AccountIdentity) -> Vec<SecretToken> {
        let mut list = Vec::new();
        match identity {
            AccountIdentity::Primary => {
                if let Some(t) = &self.primary_token {
                    list.push(t.clone());
                }
                if let Some(t) = &self.secondary_token {
                    list.push(t.clone());
                }
            }
            AccountIdentity::Secondary => {
                if let Some(t) = &self.secondary_token {
                    list.push(t.clone());
                }
                if let Some(t) = &self.primary_token {
                    list.push(t.clone());
                }
            }
            AccountIdentity::ReadOnly => {
                if let Some(t) = &self.read_only_token {
                    list.push(t.clone());
                }
                if let Some(t) = &self.secondary_token {
                    list.push(t.clone());
                }
                if let Some(t) = &self.primary_token {
                    list.push(t.clone());
                }
            }
        }
        list
    }

    fn get(&self, identity: AccountIdentity) -> Result<SecretToken, DiscordError> {
        let candidates = self.candidate_tokens(identity);
        candidates
            .into_iter()
            .next()
            .ok_or(DiscordError::MissingCredential(identity))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountIdentity {
    Primary,
    Secondary,
    ReadOnly,
}

#[derive(Debug, thiserror::Error)]
pub enum DiscordError {
    #[error("No credential configured for {0:?} identity")]
    MissingCredential(AccountIdentity),
    #[error("Discord account is unavailable or requires verification")]
    CredentialUnavailable,
    #[error("Invalid Discord API path")]
    InvalidPath,
    #[error("Discord returned HTTP {status}: {body}")]
    Http { status: StatusCode, body: String },
    #[error("Discord rate limited this request (scope: {scope}, retry after {retry_after})")]
    RateLimited { scope: String, retry_after: String },
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

#[derive(Clone)]
pub struct DiscordRouter {
    client: reqwest::Client,
    client_environment: ClientEnvironment,
    tokens: Arc<RwLock<TokenManager>>,
    credential_health: Arc<Mutex<HashMap<u64, CachedCredentialHealth>>>,
    rate_limits: Arc<Mutex<RateLimitState>>,
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
        Self::with_installation_id_path_inner(tokens, None)
    }

    pub fn with_installation_id_path(tokens: TokenManager, path: PathBuf) -> Self {
        Self::with_installation_id_path_inner(tokens, Some(path))
    }

    fn with_installation_id_path_inner(
        tokens: TokenManager,
        installation_id_path: Option<PathBuf>,
    ) -> Self {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT};

        let client_environment = ClientEnvironment::detect(installation_id_path);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(CHROME_USER_AGENT));
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
        if let Ok(value) = HeaderValue::from_str(&client_environment.locale) {
            headers.insert(ACCEPT_LANGUAGE, value.clone());
            headers.insert("x-discord-locale", value);
        }
        if let Ok(value) = HeaderValue::from_str(&client_environment.timezone) {
            headers.insert("x-discord-timezone", value);
        }
        let super_properties = client_environment.super_properties();
        headers.insert(
            "x-debug-options",
            HeaderValue::from_static("bugReporterEnabled"),
        );
        if let Ok(value) = HeaderValue::from_str(&STANDARD.encode(super_properties.to_string())) {
            headers.insert("x-super-properties", value);
        }
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            client_environment,
            tokens: Arc::new(RwLock::new(tokens)),
            credential_health: Arc::new(Mutex::new(HashMap::new())),
            rate_limits: Arc::new(Mutex::new(RateLimitState::default())),
            pending_captchas: Arc::new(RwLock::new(HashMap::new())),
            gateway_sender: Arc::new(RwLock::new(None)),
            gateway_session: Arc::new(Mutex::new(GatewaySession::default())),
        }
    }

    pub async fn update_tokens(&self, tokens: TokenManager) {
        *self.tokens.write().await = tokens;
    }

    pub async fn record_credential_health(&self, token: &str, available: bool) {
        self.credential_health.lock().await.insert(
            hash_rate_limit_key(token),
            CachedCredentialHealth {
                available,
                checked_at: tokio::time::Instant::now(),
            },
        );
    }

    pub async fn account_credential_available(&self, token: &str) -> bool {
        let token_key = hash_rate_limit_key(token);
        let now = tokio::time::Instant::now();
        {
            let mut health = self.credential_health.lock().await;
            health
                .retain(|_, entry| now.duration_since(entry.checked_at) < UNAVAILABLE_ACCOUNT_TTL);
            if let Some(entry) = health.get(&token_key) {
                let ttl = if entry.available {
                    ACCOUNT_HEALTH_TTL
                } else {
                    UNAVAILABLE_ACCOUNT_TTL
                };
                if now.duration_since(entry.checked_at) < ttl {
                    return entry.available;
                }
            }
        }

        let available = match self
            .rest_with_auth_quiet_auth_failure(
                token,
                AccountIdentity::ReadOnly,
                Method::GET,
                "users/@me",
            )
            .await
        {
            Ok(_) => true,
            Err(error) if is_account_access_blocked(&error) => false,
            Err(error) => {
                log::debug!("Discord account health check was inconclusive: {error}");
                return true;
            }
        };
        self.record_credential_health(token, available).await;
        available
    }

    async fn wait_for_rate_limit(&self, token: &SecretToken, method: &Method, path: &str) {
        let token_key = token_rate_limit_key(token);
        let route_key = route_rate_limit_key(token_key, method, path);
        loop {
            let deadline = {
                let mut limits = self.rate_limits.lock().await;
                let now = tokio::time::Instant::now();
                limits.global_until.retain(|_, until| *until > now);
                limits.route_until.retain(|_, until| *until > now);
                let route_bucket = limits.route_buckets.get(&route_key).copied();
                let global = limits.global_until.get(&token_key).copied();
                let route = route_bucket
                    .and_then(|bucket| limits.route_until.get(&bucket).copied())
                    .or_else(|| limits.route_until.get(&route_key).copied());
                match (global, route) {
                    (Some(global), Some(route)) => Some(global.max(route)),
                    (Some(global), None) => Some(global),
                    (None, Some(route)) => Some(route),
                    (None, None) => None,
                }
            };
            let Some(deadline) = deadline else {
                return;
            };
            tokio::time::sleep_until(deadline).await;
        }
    }

    async fn record_rate_limit_headers(
        &self,
        token: &SecretToken,
        method: &Method,
        path: &str,
        headers: &header::HeaderMap,
    ) {
        let Some(bucket) = headers
            .get("x-ratelimit-bucket")
            .and_then(|value| value.to_str().ok())
        else {
            return;
        };
        let Some(remaining) = headers
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
        else {
            return;
        };
        let token_key = token_rate_limit_key(token);
        let route_key = route_rate_limit_key(token_key, method, path);
        let bucket_token_key = if rate_limit_is_shared(headers) {
            0
        } else {
            token_key
        };
        let bucket_key = bucket_rate_limit_key(bucket_token_key, bucket, path);
        let mut limits = self.rate_limits.lock().await;
        limits.route_buckets.insert(route_key, bucket_key);
        if remaining == 0 {
            if let Some(reset_after) = headers
                .get("x-ratelimit-reset-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
                .and_then(|seconds| Duration::try_from_secs_f64(seconds).ok())
            {
                limits
                    .route_until
                    .insert(bucket_key, tokio::time::Instant::now() + reset_after);
            }
        }
    }

    async fn record_rate_limit_response(
        &self,
        token: &SecretToken,
        method: &Method,
        path: &str,
        headers: &header::HeaderMap,
        retry_after: Duration,
        global: bool,
        shared: bool,
    ) {
        let token_key = token_rate_limit_key(token);
        let route_key = route_rate_limit_key(token_key, method, path);
        let bucket_token_key = if shared { 0 } else { token_key };
        let bucket_key = headers
            .get("x-ratelimit-bucket")
            .and_then(|value| value.to_str().ok())
            .map(|bucket| bucket_rate_limit_key(bucket_token_key, bucket, path))
            .unwrap_or(route_key);
        let until = tokio::time::Instant::now() + retry_after;
        let mut limits = self.rate_limits.lock().await;
        if global {
            limits.global_until.insert(token_key, until);
        } else {
            limits.route_until.insert(bucket_key, until);
            if headers.get("x-ratelimit-bucket").is_some() {
                limits.route_buckets.insert(route_key, bucket_key);
            }
        }
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
        self.rest_with_auth(None, identity, method, path, body)
            .await
    }

    pub async fn rest_with_auth(
        &self,
        custom_token: Option<&str>,
        identity: AccountIdentity,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, DiscordError> {
        let path = path.trim_start_matches('/');
        if path.contains("..") || path.starts_with("http") {
            return Err(DiscordError::InvalidPath);
        }
        self.perform_rest(
            custom_token,
            identity,
            method,
            path.to_owned(),
            body,
            None,
            false,
        )
        .await
    }

    pub async fn rest_with_auth_quiet_auth_failure(
        &self,
        custom_token: &str,
        identity: AccountIdentity,
        method: Method,
        path: &str,
    ) -> Result<Value, DiscordError> {
        let path = path.trim_start_matches('/');
        if path.contains("..") || path.starts_with("http") {
            return Err(DiscordError::InvalidPath);
        }
        self.perform_rest(
            Some(custom_token),
            identity,
            method,
            path.to_owned(),
            None,
            None,
            true,
        )
        .await
    }

    pub async fn send_message_with_files(
        &self,
        custom_token: Option<&str>,
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
            return Err(DiscordError::Http {
                status: StatusCode::BAD_REQUEST,
                body: "Choose between 1 and 10 files".to_owned(),
            });
        }
        let token_string = if let Some(t) = custom_token {
            Arc::from(t)
        } else {
            let tokens = self.tokens.read().await;
            tokens.get(identity)?.0.clone()
        };
        let token = SecretToken(token_string);
        let upload_check_started = std::time::Instant::now();
        log::debug!("Discord upload tier request: GET /users/@me (identity={identity:?})");
        let account = self
            .rest_with_auth(
                Some(token.0.as_ref()),
                identity,
                Method::GET,
                "users/@me",
                None,
            )
            .await?;
        log::debug!(
            "Discord upload tier response: GET /users/@me -> success ({:?})",
            upload_check_started.elapsed()
        );
        let premium_type = account
            .get("premium_type")
            .and_then(Value::as_u64)
            .unwrap_or(0);
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
        let mut total_size = 0u64;
        let mut upload_files = Vec::with_capacity(files.len());
        for file_path in files {
            let metadata =
                tokio::fs::metadata(&file_path)
                    .await
                    .map_err(|error| DiscordError::Http {
                        status: StatusCode::BAD_REQUEST,
                        body: format!("Could not read selected attachment: {error}"),
                    })?;
            if !metadata.is_file() {
                return Err(DiscordError::Http {
                    status: StatusCode::BAD_REQUEST,
                    body: "An attachment path is not a file".to_owned(),
                });
            }
            let file_size = metadata.len();
            if file_size > size_limit {
                return Err(DiscordError::Http {
                    status: StatusCode::PAYLOAD_TOO_LARGE,
                    body: format!(
                        "This account's upload tier allows files up to {} MiB",
                        size_limit / (1024 * 1024)
                    ),
                });
            }
            total_size = total_size.saturating_add(file_size);
            if total_size > size_limit {
                return Err(DiscordError::Http {
                    status: StatusCode::PAYLOAD_TOO_LARGE,
                    body: format!(
                        "Attachments exceed this account's {} MiB per-message upload allowance",
                        size_limit / (1024 * 1024)
                    ),
                });
            }
            let filename = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("attachment")
                .chars()
                .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
                .take(180)
                .collect::<String>();
            upload_files.push((file_path, filename, file_size));
        }
        let upload_started = std::time::Instant::now();
        log::debug!("Discord multipart request: POST /channels/{channel_id}/messages (bytes={total_size}, identity={identity:?})");
        let upload_path = format!("channels/{channel_id}/messages");
        let mut rate_limit_retries = 0;
        loop {
            self.wait_for_rate_limit(&token, &Method::POST, &upload_path)
                .await;
            let mut form =
                reqwest::multipart::Form::new().text("payload_json", payload_json.to_string());
            for (index, (file_path, filename, file_size)) in upload_files.iter().enumerate() {
                let file =
                    tokio::fs::File::open(file_path)
                        .await
                        .map_err(|error| DiscordError::Http {
                            status: StatusCode::BAD_REQUEST,
                            body: format!("Could not open selected attachment: {error}"),
                        })?;
                let stream = tokio_util::io::ReaderStream::new(file);
                let body = reqwest::Body::wrap_stream(stream);
                let part = reqwest::multipart::Part::stream_with_length(body, *file_size)
                    .file_name(filename.clone());
                form = form.part(format!("files[{index}]"), part);
            }
            let response = self
                .client
                .post(format!("{DISCORD_API}/{upload_path}"))
                .header(header::AUTHORIZATION, token.authorization_value())
                .multipart(form)
                .send()
                .await?;
            let status = response.status();
            let headers = response.headers().clone();
            self.record_rate_limit_headers(&token, &Method::POST, &upload_path, &headers)
                .await;
            let bytes = response.bytes().await?;
            log::debug!("Discord multipart response: POST /channels/{channel_id}/messages -> {status} ({:?}, response_bytes={})", upload_started.elapsed(), bytes.len());
            if verbose_network_trace() {
                let response_value = serde_json::from_slice::<Value>(&bytes)
                    .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned().into());
                trace_payload("Discord multipart response", &response_value);
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                let response_json = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
                let retry_after = parse_retry_after(&headers, &response_json);
                let global = rate_limit_is_global(&headers, &response_json);
                let scope = rate_limit_scope(&headers, global);
                if let Some(seconds) = retry_after {
                    if let Some(retry_duration) = Duration::try_from_secs_f64(seconds)
                        .ok()
                        .filter(|_| rate_limit_retries < MAX_RATE_LIMIT_RETRIES)
                    {
                        self.record_rate_limit_response(
                            &token,
                            &Method::POST,
                            &upload_path,
                            &headers,
                            retry_duration,
                            global,
                            rate_limit_is_shared(&headers),
                        )
                        .await;
                        rate_limit_retries += 1;
                        log::warn!("Discord rate limit: POST /channels/{channel_id}/messages [scope={scope}, retry_after={seconds:.3}s]");
                        continue;
                    }
                    return Err(DiscordError::RateLimited {
                        scope,
                        retry_after: format!("{seconds:.3}s"),
                    });
                }
            }
            if !status.is_success() {
                let detail = serde_json::from_slice::<DiscordErrorBody>(&bytes)
                    .map(|error| {
                        format!(
                            "{} (Discord code {:?})",
                            error.message.unwrap_or_default(),
                            error.code
                        )
                    })
                    .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
                return Err(DiscordError::Http {
                    status,
                    body: detail,
                });
            }
            if bytes.is_empty() {
                return Ok(Value::Null);
            }
            return Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null));
        }
    }

    pub async fn retry_captcha(
        &self,
        request_id: &str,
        captcha_key: &str,
    ) -> Result<Value, DiscordError> {
        if captcha_key.trim().is_empty() {
            return Err(DiscordError::Http {
                status: StatusCode::BAD_REQUEST,
                body: "A CAPTCHA response is required".to_owned(),
            });
        }
        let pending = self
            .pending_captchas
            .write()
            .await
            .remove(request_id)
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
            None,
            pending.identity,
            pending.method,
            pending.path,
            pending.body,
            Some((captcha_key.to_owned(), pending.rq_token, pending.session_id)),
            false,
        )
        .await
    }

    async fn perform_rest(
        &self,
        custom_token: Option<&str>,
        identity: AccountIdentity,
        method: Method,
        path: String,
        body: Option<Value>,
        captcha: Option<(String, Option<String>, Option<String>)>,
        quiet_auth_failure: bool,
    ) -> Result<Value, DiscordError> {
        let log_path = redact_sensitive_query(&path);
        log::debug!("HTTP >>> {} {} [identity={identity:?}]", method, log_path);
        if let Some(request_body) = body.as_ref() {
            trace_payload("Discord REST request", request_body);
        }
        let request_started = std::time::Instant::now();
        let mut candidate_tokens = if let Some(t) = custom_token {
            vec![SecretToken(Arc::from(t))]
        } else {
            let tokens = self.tokens.read().await;
            tokens.candidate_tokens(identity)
        };
        if candidate_tokens.is_empty() {
            return Err(DiscordError::MissingCredential(identity));
        }
        if captcha.is_none() {
            let now = tokio::time::Instant::now();
            let health = self.credential_health.lock().await;
            candidate_tokens.retain(|token| {
                health
                    .get(&token_rate_limit_key(token))
                    .map(|entry| {
                        entry.available
                            || now.duration_since(entry.checked_at) >= UNAVAILABLE_ACCOUNT_TTL
                    })
                    .unwrap_or(true)
            });
            if candidate_tokens.is_empty() {
                return Err(DiscordError::CredentialUnavailable);
            }
        }

        let (api_base, request_path) = if let Some(route) = path.strip_prefix("api-v9/") {
            ("https://discord.com/api/v9", route)
        } else {
            (DISCORD_API, path.as_str())
        };

        let mut last_response = None;
        let candidate_count = candidate_tokens.len();

        'candidate: for (idx, token) in candidate_tokens.into_iter().enumerate() {
            let mut rate_limit_retries = 0;
            loop {
                self.wait_for_rate_limit(&token, &method, &path).await;
                let mut request = self
                    .client
                    .request(method.clone(), format!("{api_base}/{request_path}"))
                    .header(header::AUTHORIZATION, token.authorization_value());
                if let Some(installation_id) = self.client_environment.installation_id() {
                    request = request.header("x-installation-id", installation_id);
                }
                if let Some((captcha_key, rq_token, session_id)) = &captcha {
                    request = request.header("X-Captcha-Key", captcha_key);
                    if let Some(rq_token) = rq_token {
                        request = request.header("X-Captcha-Rqtoken", rq_token);
                    }
                    if let Some(session_id) = session_id {
                        request = request.header("X-Captcha-Session-Id", session_id);
                    }
                }
                if let Some(json) = &body {
                    request = request.json(json);
                }
                let response = match request.send().await {
                    Ok(response) => response,
                    Err(error) => {
                        if quiet_auth_failure {
                            log::debug!(
                                "Discord account-specific read transport failed: {} {} ({})",
                                method,
                                log_path,
                                error
                            );
                        } else {
                            log::warn!(
                                "Discord REST transport error: {} {} ({})",
                                method,
                                log_path,
                                error
                            );
                        }
                        return Err(DiscordError::from(error));
                    }
                };

                let status = response.status();
                let is_current_user_route = path.split('?').next() == Some("users/@me");
                if status == StatusCode::UNAUTHORIZED
                    || (status == StatusCode::FORBIDDEN && is_current_user_route)
                {
                    self.record_credential_health(token.0.as_ref(), false).await;
                } else if status.is_success() && is_current_user_route {
                    self.record_credential_health(token.0.as_ref(), true).await;
                }
                if (status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN)
                    && idx + 1 < candidate_count
                {
                    if quiet_auth_failure {
                        log::debug!(
                            "Discord REST {} {} [identity={identity:?}] received status {}, retrying with fallback credential",
                            method,
                            log_path,
                            status
                        );
                    } else {
                        log::warn!(
                            "Discord REST {} {} [identity={identity:?}] received status {}, retrying with fallback credential",
                            method,
                            log_path,
                            status
                        );
                    }
                    continue 'candidate;
                }

                let headers = response.headers().clone();
                self.record_rate_limit_headers(&token, &method, &path, &headers)
                    .await;
                if status == StatusCode::TOO_MANY_REQUESTS
                    && headers.get("captcha-sitekey").is_none()
                {
                    let bytes = response.bytes().await?;
                    let response_json =
                        serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
                    let retry_after = parse_retry_after(&headers, &response_json);
                    let global = rate_limit_is_global(&headers, &response_json);
                    let scope = rate_limit_scope(&headers, global);
                    if quiet_auth_failure {
                        log::debug!(
                            "Discord account-specific read rate limited: {} {} [scope={scope}, retry_after={}]",
                            method,
                            log_path,
                            retry_after
                                .map(|seconds| format!("{seconds:.3}s"))
                                .unwrap_or_else(|| "unknown".to_owned())
                        );
                    } else {
                        log::warn!(
                            "Discord rate limit: {} {} [scope={scope}, retry_after={}]",
                            method,
                            log_path,
                            retry_after
                                .map(|seconds| format!("{seconds:.3}s"))
                                .unwrap_or_else(|| "unknown".to_owned())
                        );
                    }
                    if let Some(seconds) = retry_after {
                        let retry_duration = Duration::try_from_secs_f64(seconds).ok();
                        if rate_limit_retries < MAX_RATE_LIMIT_RETRIES {
                            if let Some(retry_duration) = retry_duration {
                                self.record_rate_limit_response(
                                    &token,
                                    &method,
                                    &path,
                                    &headers,
                                    retry_duration,
                                    global,
                                    rate_limit_is_shared(&headers),
                                )
                                .await;
                                rate_limit_retries += 1;
                                continue;
                            }
                        }
                        return Err(DiscordError::RateLimited {
                            scope,
                            retry_after: format!("{seconds:.3}s"),
                        });
                    }
                    let detail = serde_json::from_slice::<DiscordErrorBody>(&bytes)
                        .map(|error| {
                            error
                                .message
                                .unwrap_or_else(|| "Discord rate limited this request".to_owned())
                        })
                        .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
                    return Err(DiscordError::Http {
                        status,
                        body: detail,
                    });
                }

                last_response = Some(response);
                break;
            }
        }

        let response = last_response.ok_or(DiscordError::MissingCredential(identity))?;
        let status = response.status();
        let elapsed = request_started.elapsed();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");
        let rate_limit_remaining = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");
        let rate_limit_reset = response
            .headers()
            .get("x-ratelimit-reset-after")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");
        let rate_limit_bucket = response
            .headers()
            .get("x-ratelimit-bucket")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-");
        log::debug!(
            "HTTP <<< {} {} -> {} ({:?}, retry-after={}, remaining={}, reset-after={}, bucket={})",
            method,
            log_path,
            status,
            elapsed,
            retry_after,
            rate_limit_remaining,
            rate_limit_reset,
            rate_limit_bucket
        );
        let captcha_headers = (
            response
                .headers()
                .get("captcha-sitekey")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
            response
                .headers()
                .get("captcha-rqdata")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
            response
                .headers()
                .get("captcha-rqtoken")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
            response
                .headers()
                .get("captcha-session-id")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
            response
                .headers()
                .get("captcha-service")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
        );
        let bytes = response.bytes().await?;
        if verbose_network_trace() {
            let response_value = serde_json::from_slice::<Value>(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
            trace_payload(
                &format!("Discord REST response {method} {log_path} -> {status}"),
                &response_value,
            );
        }
        if !status.is_success() {
            let response_json = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
            if status == StatusCode::TOO_MANY_REQUESTS
                || (!quiet_auth_failure
                    && matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND))
            {
                log::warn!(
                    "HTTP ERROR BODY {} {} -> {}: {}",
                    method,
                    log_path,
                    status,
                    serde_json::to_string(&redact_json(&response_json))
                        .unwrap_or_else(|_| "<unserializable>".to_owned())
                );
            }
            let site_key = response_json
                .get("captcha_sitekey")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(captcha_headers.0);
            let rq_data = response_json
                .get("captcha_rqdata")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(captcha_headers.1);
            let rq_token = response_json
                .get("captcha_rqtoken")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(captcha_headers.2);
            let session_id = response_json
                .get("captcha_session_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(captcha_headers.3);
            let service = response_json
                .get("captcha_service")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(captcha_headers.4)
                .unwrap_or_else(|| "hcaptcha".to_owned());
            if site_key.is_some() {
                let request_id = format!(
                    "captcha-{}",
                    CAPTCHA_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
                );
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
                pending_requests
                    .retain(|_, request| request.created_at.elapsed() <= Duration::from_secs(300));
                pending_requests.insert(request_id.clone(), pending);
                let challenge = CaptchaChallenge {
                    request_id,
                    service,
                    site_key,
                    rq_data,
                };
                return Err(DiscordError::CaptchaRequired(serde_json::to_string(
                    &challenge,
                )?));
            }
            if quiet_auth_failure {
                log::debug!(
                    "Discord account-specific read was not available: {} {} -> {}",
                    method,
                    log_path,
                    status
                );
            } else {
                log::warn!(
                    "Discord REST request rejected: {} {} -> {}",
                    method,
                    log_path,
                    status
                );
            }
            let body = serde_json::from_slice::<DiscordErrorBody>(&bytes)
                .map(|e| {
                    format!(
                        "{} (Discord code {:?})",
                        e.message.unwrap_or_default(),
                        e.code
                    )
                })
                .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());
            return Err(DiscordError::Http { status, body });
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        match serde_json::from_slice(&bytes) {
            Ok(value) => Ok(value),
            Err(error) => {
                log::warn!(
                    "Discord REST response JSON parse failed for {} {}: {error}; body_len={}",
                    method,
                    log_path,
                    bytes.len()
                );
                Ok(Value::Null)
            }
        }
    }

    pub async fn listen_gateway<F>(
        &self,
        identity: AccountIdentity,
        on_event: F,
    ) -> Result<(), DiscordError>
    where
        F: Fn(Value) + Send + Sync + 'static,
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
        on_event: F,
    ) -> Result<(), DiscordError>
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        // Wrap in Arc so the callback can be shared across spawned dispatch tasks
        // without requiring F: Clone.
        let on_event = std::sync::Arc::new(on_event);
        let token = {
            let tokens = self.tokens.read().await;
            tokens.get(identity)?.clone()
        };
        *self.gateway_sender.write().await = None;

        loop {
            let reachability_started = std::time::Instant::now();
            match self
                .client
                .get(format!("{DISCORD_API}/gateway"))
                .timeout(Duration::from_secs(3))
                .send()
                .await
            {
                Ok(response) => {
                    log::debug!(
                        "Discord reachability request: GET /gateway -> {} ({:?})",
                        response.status(),
                        reachability_started.elapsed()
                    );
                    break;
                }
                Err(error) => {
                    log::debug!("Discord reachability request failed: GET /gateway ({:?}): {error}; retrying in 5s", reachability_started.elapsed());
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }

        let (connect_url, should_resume) = {
            let mut session = self.gateway_session.lock().await;
            let within_window = session
                .disconnected_at
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
                session
                    .resume_gateway_url
                    .as_deref()
                    .unwrap_or(DISCORD_GATEWAY)
            } else {
                DISCORD_GATEWAY
            };
            let mut parsed =
                url::Url::parse(raw_url).map_err(|_| DiscordError::InvalidWebSocketUrl)?;
            parsed
                .query_pairs_mut()
                .clear()
                .append_pair("v", "10")
                .append_pair("encoding", "json");
            (parsed.to_string(), can_resume)
        };

        let gateway_connect_started = std::time::Instant::now();
        let safe_gateway_url = url::Url::parse(&connect_url)
            .map(|mut parsed| {
                parsed.set_query(None);
                parsed.to_string()
            })
            .unwrap_or_else(|_| "<invalid gateway URL>".to_owned());
        log::info!("GATEWAY connecting: {safe_gateway_url} (resume={should_resume}, identity={identity:?})");
        let (mut socket, _) = match connect_async(connect_url.as_str()).await {
            Ok(res) => {
                log::info!(
                    "GATEWAY connected ({:?})",
                    gateway_connect_started.elapsed()
                );
                res
            }
            Err(e) => {
                log::warn!(
                    "Gateway connection failed after {:?}: {e}",
                    gateway_connect_started.elapsed()
                );
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
                    let payload_op = payload.get("op").and_then(Value::as_u64);
                    log::debug!("GATEWAY >>> outbound op={payload_op:?}, bytes={}", payload.to_string().len());
                    trace_payload("Gateway outbound", &payload);
                    if payload_op == Some(14) {
                        pending_member_request = Some(payload);
                    } else {
                        log::debug!("GATEWAY sending outbound op={payload_op:?}");
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
                        log::info!("GATEWAY >>> sent delayed member-list request");
                        next_member_request_at = tokio::time::Instant::now() + Duration::from_secs(2);
                    }
                }
                _ = heartbeat.tick(), if heartbeat_interval.is_some() => {
                    let payload = serde_json::json!({"op": 1, "d": sequence});
                    log::debug!("GATEWAY >>> heartbeat op=1 seq={sequence:?}");
                    if let Err(e) = socket.send(WsMessage::Text(payload.to_string())).await {
                        log::warn!("Gateway heartbeat send error: {e}");
                        break;
                    }
                }
                message = socket.next() => {
                    let Some(message_result) = message else {
                        return Err(DiscordError::WebSocketClosed);
                    };

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
                            let event_name = event.get("t").and_then(Value::as_str).unwrap_or("<no-dispatch-name>");
                            let event_bytes = text.len();
                            log::debug!("GATEWAY <<< event={event_name} op={op:?} seq={:?} bytes={event_bytes}", event.get("s").and_then(Value::as_u64));
                            trace_payload(&format!("Gateway inbound {event_name} op={op:?}"), &event);
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
                                    let mut handshake = if should_resume {
                                        let session = self.gateway_session.lock().await;
                                        serde_json::json!({
                                            "op": 6,
                                            "d": {
                                                "token": token.gateway_value(),
                                                "session_id": session.session_id,
                                                "seq": sequence
                                            }
                                        })
                                    } else {
                                        serde_json::json!({
                                            "op": 2,
                                            "d": {
                                                "token": token.gateway_value(),
                                                "capabilities": 176421,
                                                "properties": self.client_environment.gateway_properties()
                                            }
                                        })
                                    };
                                    if !should_resume && token.is_bot() {
                                        handshake["d"]["intents"] =
                                            serde_json::json!(BOT_GATEWAY_INTENTS);
                                    }
                                    log::debug!("Gateway handshake sending: op={} (resume={should_resume}); token redacted", handshake.get("op").and_then(Value::as_u64).unwrap_or_default());
                                    trace_payload("Gateway handshake", &handshake);
                                    if let Err(e) = socket.send(WsMessage::Text(handshake.to_string())).await {
                                        log::warn!("Gateway handshake send error: {e}");
                                        break;
                                    }
                                    identified = true;
                                }
                            }

                            if op == Some(1) {
                                log::debug!("GATEWAY heartbeat requested by server (op=1, seq={sequence:?})");
                                let payload = serde_json::json!({"op": 1, "d": sequence});
                                let _ = socket.send(WsMessage::Text(payload.to_string())).await;
                            } else if op == Some(7) {
                                log::warn!("GATEWAY server requested reconnect (op=7)");
                                return Err(DiscordError::WebSocketClosed);
                            } else if op == Some(9) {
                                let resumable = event.get("d").and_then(Value::as_bool).unwrap_or(false);
                                log::warn!("GATEWAY invalid session (op=9, resumable={resumable})");
                                let mut session = self.gateway_session.lock().await;
                                session.resumable = resumable;
                                if !resumable {
                                    *session = GatewaySession::default();
                                }
                                return Err(DiscordError::WebSocketClosed);
                            }

                            if event.get("t").and_then(Value::as_str) == Some("READY") {
                                let d = event.get("d").cloned().unwrap_or(Value::Null);
                                if let Some(installation_id) = d
                                    .pointer("/apex_experiments/installation")
                                    .and_then(Value::as_str)
                                {
                                    if let Err(error) = self
                                        .client_environment
                                        .set_installation_id(installation_id)
                                    {
                                        log::warn!("{error}");
                                    }
                                }
                                {
                                    let wait_started = std::time::Instant::now();
                                    let mut session = self.gateway_session.lock().await;
                                    let waited = wait_started.elapsed();
                                    if waited >= Duration::from_millis(100) {
                                        log::warn!("Suspected gateway_session lock stall: waited {:?} handling READY", waited);
                                    }
                                    session.session_id = d.get("session_id").and_then(Value::as_str).map(str::to_owned);
                                    session.resume_gateway_url = d.get("resume_gateway_url").and_then(Value::as_str).map(str::to_owned);
                                    session.sequence = sequence;
                                    session.disconnected_at = None;
                                    session.resumable = session.session_id.is_some() && session.resume_gateway_url.is_some();
                                }
                                let wait_started = std::time::Instant::now();
                                let mut sender = self.gateway_sender.write().await;
                                let waited = wait_started.elapsed();
                                if waited >= Duration::from_millis(100) {
                                    log::warn!("Suspected gateway_sender lock stall: waited {:?} publishing READY", waited);
                                }
                                *sender = Some(gateway_tx.clone());
                            } else if event.get("t").and_then(Value::as_str) == Some("RESUMED") {
                                {
                                    let wait_started = std::time::Instant::now();
                                    let mut session = self.gateway_session.lock().await;
                                    let waited = wait_started.elapsed();
                                    if waited >= Duration::from_millis(100) {
                                        log::warn!("Suspected gateway_session lock stall: waited {:?} handling RESUMED", waited);
                                    }
                                    session.sequence = sequence;
                                    session.disconnected_at = None;
                                    session.resumable = true;
                                }
                                let wait_started = std::time::Instant::now();
                                let mut sender = self.gateway_sender.write().await;
                                let waited = wait_started.elapsed();
                                if waited >= Duration::from_millis(100) {
                                    log::warn!("Suspected gateway_sender lock stall: waited {:?} publishing RESUMED", waited);
                                }
                                *sender = Some(gateway_tx.clone());
                            }

                            if let Some(seq) = sequence {
                                // Fold sequence update into READY/RESUMED lock blocks above;
                                // for all other events we avoid locking the session mutex on
                                // every dispatch — the local `sequence` variable already tracks it.
                                if event.get("t").and_then(Value::as_str)
                                    .map(|t| t != "READY" && t != "RESUMED")
                                    .unwrap_or(true)
                                {
                                    self.gateway_session.lock().await.sequence = Some(seq);
                                }
                            }

                            let event_name = event_name.to_owned();
                            log::debug!("GATEWAY callback scheduled: {event_name}");
                            // Spawn the callback so it never blocks the gateway select loop.
                            // Trace scheduling, actual execution, and callback duration separately.
                            let on_event = std::sync::Arc::clone(&on_event);
                            let callback_event_name = event_name.clone();
                            tokio::spawn(async move {
                                let callback_started = std::time::Instant::now();
                                log::debug!("GATEWAY callback started: {callback_event_name}");
                                on_event(event);
                                log::debug!(
                                    "GATEWAY callback finished: {callback_event_name} elapsed={:?}",
                                    callback_started.elapsed()
                                );
                            });
                        }
                        WsMessage::Ping(payload) => {
                            log::debug!("GATEWAY WebSocket ping received ({} bytes)", payload.len());
                            let _ = socket.send(WsMessage::Pong(payload)).await;
                        }
                        WsMessage::Close(frame) => {
                            log::warn!("GATEWAY WebSocket close frame: {frame:?}");
                            return Err(DiscordError::WebSocketClosed);
                        }
                        WsMessage::Pong(payload) => {
                            log::debug!("GATEWAY WebSocket pong received ({} bytes)", payload.len());
                        }
                        WsMessage::Binary(payload) => {
                            log::warn!("GATEWAY unexpected binary frame ({} bytes)", payload.len());
                        }
                        _ => {}
                    }
                }
            }
        }
        Err(DiscordError::WebSocketClosed)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestIntent {
    Browse,
    Listen,
    SendMessage,
    AddReaction,
    RemoveReaction,
}

#[allow(dead_code)]
impl RequestIntent {
    pub const fn identity(self) -> AccountIdentity {
        match self {
            Self::Browse | Self::Listen => AccountIdentity::ReadOnly,
            Self::SendMessage | Self::AddReaction | Self::RemoveReaction => {
                AccountIdentity::Primary
            }
        }
    }
}

#[allow(dead_code)]
#[derive(Default, Clone)]
pub struct CommunityAccountPreferences {
    by_community: Arc<RwLock<HashMap<String, AccountIdentity>>>,
}

#[allow(dead_code)]
impl CommunityAccountPreferences {
    pub async fn set(&self, community_id: String, identity: AccountIdentity) {
        self.by_community
            .write()
            .await
            .insert(community_id, identity);
    }

    pub async fn get(&self, community_id: &str) -> Option<AccountIdentity> {
        self.by_community.read().await.get(community_id).copied()
    }
}

#[allow(dead_code)]
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
    fn normalizes_system_locale_for_discord_headers() {
        assert_eq!(normalize_locale("fr_CA.UTF-8"), "fr-CA");
        assert_eq!(normalize_locale("en-US"), "en-US");
        assert_eq!(normalize_locale("C.UTF-8"), "en-US");
        #[cfg(not(windows))]
        assert_eq!(
            parse_locale_output("LANG=\"de_DE.UTF-8\"\nLC_MESSAGES=\"fr_FR.UTF-8\"\n").as_deref(),
            Some("fr_FR.UTF-8")
        );
    }

    #[test]
    fn gateway_properties_use_detected_locale() {
        let environment = ClientEnvironment {
            locale: "ja-JP".to_owned(),
            timezone: "Asia/Tokyo".to_owned(),
            launch_id: uuid::Uuid::nil(),
            installation_id: Arc::new(StdRwLock::new(Some("server-issued-id".to_owned()))),
            installation_id_path: None,
        };
        let properties = environment.gateway_properties();
        assert_eq!(properties["system_locale"], "ja-JP");
        assert_eq!(properties["browser_user_agent"], CHROME_USER_AGENT);
        assert_eq!(properties["browser_version"], CHROME_VERSION);
        assert_eq!(properties["app_arch"], discord_architecture());
        assert_eq!(
            properties["client_launch_id"],
            uuid::Uuid::nil().to_string()
        );
        assert_eq!(properties["installation_id"], "server-issued-id");
        assert!(environment
            .super_properties()
            .get("installation_id")
            .is_none());
    }

    #[test]
    fn bot_tokens_use_bot_rest_auth_and_raw_gateway_token() {
        let token = SecretToken(Arc::from("Bot bot-token"));
        assert!(token.is_bot());
        assert_eq!(token.authorization_value(), "Bot bot-token");
        assert_eq!(token.gateway_value(), "bot-token");

        let user_token = SecretToken(Arc::from("user-token"));
        assert!(!user_token.is_bot());
        assert_eq!(user_token.authorization_value(), "user-token");
        assert_eq!(user_token.gateway_value(), "user-token");
    }

    #[test]
    fn account_health_blocks_auth_errors_and_captcha_challenges() {
        assert!(is_account_access_blocked(&DiscordError::Http {
            status: StatusCode::UNAUTHORIZED,
            body: "Unauthorized".to_owned(),
        }));
        assert!(is_account_access_blocked(&DiscordError::Http {
            status: StatusCode::FORBIDDEN,
            body: "Forbidden".to_owned(),
        }));
        assert!(is_account_access_blocked(&DiscordError::CaptchaRequired(
            "challenge".to_owned()
        )));
        assert!(is_account_access_blocked(
            &DiscordError::CredentialUnavailable
        ));
        assert!(!is_account_access_blocked(&DiscordError::WebSocketClosed));
    }

    #[test]
    fn persists_server_issued_installation_id() {
        let path = std::env::temp_dir().join(format!(
            "voidcord-installation-id-{}.txt",
            uuid::Uuid::new_v4()
        ));
        let environment = ClientEnvironment {
            locale: "en-US".to_owned(),
            timezone: "UTC".to_owned(),
            launch_id: uuid::Uuid::new_v4(),
            installation_id: Arc::new(StdRwLock::new(None)),
            installation_id_path: Some(path.clone()),
        };

        environment.set_installation_id("server-issued-id").unwrap();
        assert_eq!(
            environment.installation_id().as_deref(),
            Some("server-issued-id")
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "server-issued-id");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_retry_after_from_header_or_json_body() {
        let mut headers = header::HeaderMap::new();
        headers.insert("retry-after", header::HeaderValue::from_static("1.25"));
        assert_eq!(parse_retry_after(&headers, &Value::Null), Some(1.25));

        headers.remove("retry-after");
        assert_eq!(
            parse_retry_after(&headers, &serde_json::json!({ "retry_after": 0.75 })),
            Some(0.75)
        );
        assert_eq!(
            parse_retry_after(&headers, &serde_json::json!({ "retry_after": -1 })),
            None
        );
        headers.insert("retry-after", header::HeaderValue::from_static("NaN"));
        assert_eq!(
            parse_retry_after(&headers, &serde_json::json!({ "retry_after": 0.5 })),
            Some(0.5)
        );
    }

    #[test]
    fn detects_global_and_shared_rate_limit_scopes() {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            "x-ratelimit-scope",
            header::HeaderValue::from_static("global"),
        );
        assert!(rate_limit_is_global(&headers, &Value::Null));
        assert_eq!(rate_limit_scope(&headers, true), "global");

        headers.insert(
            "x-ratelimit-scope",
            header::HeaderValue::from_static("shared"),
        );
        assert!(!rate_limit_is_global(&headers, &Value::Null));
        assert!(rate_limit_is_shared(&headers));
        assert_eq!(rate_limit_scope(&headers, false), "shared");
        assert!(rate_limit_is_global(
            &header::HeaderMap::new(),
            &serde_json::json!({ "global": true })
        ));
    }

    #[test]
    fn route_keys_ignore_query_but_keep_method_and_bucket_major_parameters() {
        let route = route_rate_limit_key(9, &Method::GET, "channels/123/messages?limit=50");
        assert_eq!(
            route,
            route_rate_limit_key(9, &Method::GET, "channels/123/messages?limit=10")
        );
        assert_ne!(
            route,
            route_rate_limit_key(9, &Method::POST, "channels/123/messages")
        );
        assert_eq!(
            bucket_rate_limit_key(9, "bucket", "channels/123/messages"),
            bucket_rate_limit_key(9, "bucket", "channels/123/messages/456")
        );
        assert_ne!(
            bucket_rate_limit_key(9, "bucket", "channels/123/messages"),
            bucket_rate_limit_key(9, "bucket", "channels/789/messages")
        );
    }

    #[test]
    fn routes_writes_and_reads_to_intended_identity() {
        assert_eq!(
            RequestIntent::SendMessage.identity(),
            AccountIdentity::Primary
        );
        assert_eq!(
            RequestIntent::AddReaction.identity(),
            AccountIdentity::Primary
        );
        assert_eq!(
            RequestIntent::RemoveReaction.identity(),
            AccountIdentity::Primary
        );
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
