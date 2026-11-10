use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{io, net::TcpListener as StdTcpListener, time::Duration};
use tokio::{net::TcpListener, sync::broadcast, time::timeout};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

const IPC_QUEUE_CAPACITY: usize = 2048;

#[derive(Clone)]
pub struct GatewayIpc {
    port: u16,
    token: String,
    events: broadcast::Sender<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayIpcConfig {
    url: String,
    token: String,
}

impl GatewayIpc {
    pub fn start() -> io::Result<Self> {
        let listener = StdTcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let listener = TcpListener::from_std(listener)?;
        let token = Uuid::new_v4().to_string();
        let (events, _) = broadcast::channel(IPC_QUEUE_CAPACITY);

        tokio::spawn(run_server(listener, token.clone(), events.clone()));
        Ok(Self { port, token, events })
    }

    pub fn address(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }

    pub fn config(&self) -> GatewayIpcConfig {
        GatewayIpcConfig {
            url: format!("ws://127.0.0.1:{}/events", self.port),
            token: self.token.clone(),
        }
    }

    pub fn publish(&self, event: &str, payload: Value) {
        let frame = json!({ "event": event, "payload": payload });
        match serde_json::to_string(&frame) {
            Ok(frame) => {
                // No connected frontend is normal during startup/reload.
                let _ = self.events.send(frame);
            }
            Err(error) => log::error!("Could not serialize Gateway IPC event {event}: {error}"),
        }
    }
}

async fn run_server(listener: TcpListener, token: String, events: broadcast::Sender<String>) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                if !peer.ip().is_loopback() {
                    log::warn!("Rejected non-loopback Gateway IPC peer: {peer}");
                    continue;
                }
                let token = token.clone();
                let events = events.clone();
                tokio::spawn(async move {
                    if let Err(error) = serve_client(stream, token, events).await {
                        log::debug!("Gateway IPC client disconnected: {error}");
                    }
                });
            }
            Err(error) => {
                log::error!("Gateway IPC accept failed: {error}");
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

async fn serve_client(
    stream: tokio::net::TcpStream,
    token: String,
    events: broadcast::Sender<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let websocket = accept_async(stream).await?;
    let (mut sink, mut incoming) = websocket.split();

    let auth = timeout(Duration::from_secs(5), incoming.next())
        .await
        .map_err(|error| io::Error::new(io::ErrorKind::TimedOut, error))?
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "missing IPC authentication frame"))??;
    let authenticated = match auth {
        Message::Text(text) => serde_json::from_str::<Value>(&text)
            .ok()
            .is_some_and(|value| {
                value.get("type").and_then(Value::as_str) == Some("auth")
                    && value.get("token").and_then(Value::as_str) == Some(token.as_str())
            }),
        _ => false,
    };
    if !authenticated {
        let _ = sink.send(Message::Close(None)).await;
        return Err("invalid IPC authentication".into());
    }

    sink.send(Message::Text(json!({ "type": "ready" }).to_string())).await?;
    let mut receiver = events.subscribe();

    loop {
        tokio::select! {
            incoming_message = incoming.next() => {
                match incoming_message {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => sink.send(Message::Pong(data)).await?,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(error.into()),
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(frame) => sink.send(Message::Text(frame)).await?,
                    // A lagging UI must not block Gateway processing. It reconnects
                    // or resynchronizes through the normal REST/cache bootstrap.
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Gateway IPC client fell behind; skipped {skipped} events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    Ok(())
}
