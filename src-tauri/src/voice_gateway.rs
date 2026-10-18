use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::UdpSocket;
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

pub struct VoiceGatewayConfig {
    pub endpoint: String,
    pub guild_id: String,
    pub channel_id: String,
    pub user_id: String,
    pub session_id: String,
    pub token: String,
}

pub struct VoiceGateway {
    config: VoiceGatewayConfig,
    udp_socket: Arc<UdpSocket>,
    transport_counter: Arc<Mutex<u32>>,
}

impl VoiceGateway {
    pub async fn new(config: VoiceGatewayConfig) -> Result<Self, String> {
        let udp_socket = Arc::new(UdpSocket::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?);
        Ok(Self {
            config,
            udp_socket,
            transport_counter: Arc::new(Mutex::new(0)),
        })
    }

    /// Khởi chạy tiến trình kết nối Voice Gateway (WebSocket + UDP IP Discovery)
    pub async fn run(&self) -> Result<(), String> {
        let ws_url = format!("wss://{}/?v=8", self.config.endpoint);
        let url = url::Url::parse(&ws_url).map_err(|_| "Invalid voice gateway URL".to_owned())?;

        let (mut ws_stream, _) = connect_async(url.as_str()).await.map_err(|e| e.to_string())?;
        println!("[VoidCord Voice] Connected to voice gateway endpoint: {}", self.config.endpoint);

        // 1. Nhận hello/heartbeat interval từ Discord voice gateway
        let msg = ws_stream.next().await.ok_or("Voice WebSocket closed prematurely")?
        .map_err(|e| e.to_string())?;
        let text = msg.to_text().map_err(|_| "Invalid text frame")?;
        let event: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;

        let heartbeat_interval = event.pointer("/d/heartbeat_interval")
            .and_then(Value::as_u64)
            .unwrap_or(41250);

        // 2. Gửi gói Identify (Opcode 2)
        let identify = json!({
            "op": 2,
            "d": {
                "server_id": self.config.guild_id,
                "channel_id": self.config.channel_id,
                "user_id": self.config.user_id,
                "session_id": self.config.session_id,
                "token": self.config.token,
                "video": true,
                "streams": [
                    { "type": "video", "rid": "100", "quality": 100 }
                ]
            }
        });
        ws_stream.send(WsMessage::Text(identify.to_string())).await.map_err(|e| e.to_string())?;

        let mut heartbeat_timer = tokio::time::interval(Duration::from_millis(heartbeat_interval));

        loop {
            tokio::select! {
                _ = heartbeat_timer.tick() => {
                    let hb = json!({ "op": 3, "d": {"t": timestamp_ms(), "seq_ack": 0} });
                    if ws_stream.send(WsMessage::Text(hb.to_string())).await.is_err() {
                        break;
                    }
                }
                msg = ws_stream.next() => {
                    let Some(Ok(WsMessage::Text(text))) = msg else { break; };
                    let event: Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let op = event.get("op").and_then(Value::as_u64).unwrap_or(99);
                    
                    // Opcode 2: READY -> Nhận UDP server info & thực hiện IP Discovery
                    if op == 2 {
                        let d = event.get("d").cloned().unwrap_or_default();
                        let ip = d.get("ip").and_then(Value::as_str).unwrap_or("");
                        let port = d.get("port").and_then(Value::as_u64).unwrap_or(0) as u16;
                        let ssrc = d.get("ssrc").and_then(Value::as_u64).unwrap_or(0);

                        println!("[VoidCord Voice] Gateway READY: server={ip}:{port}, ssrc={ssrc}");

                        // Thực hiện IP Discovery qua UDP
                        self.perform_ip_discovery(ip, port, ssrc as u32).await?;
                    }
                }
            }
        }

        Ok(())
    }

    /// Gửi gói tin IP Discovery (Type 1, Length 70, SSRC) để lấy IP/Port công khai từ Discord Server
    async fn perform_ip_discovery(&self, server_ip: &str, server_port: u16, ssrc: u32) -> Result<(), String> {
        self.udp_socket.connect((server_ip, server_port)).await.map_err(|e| e.to_string())?;

        let mut packet = vec![0u8; 74];
        // type = 1 (request), length = 70
        packet[0..2].copy_from_slice(&1u16.to_be_bytes());
        packet[2..4].copy_from_slice(&70u16.to_be_bytes());
        // ssrc big-endian
        packet[4..8].copy_from_slice(&ssrc.to_be_bytes());

        self.udp_socket.send(&packet).await.map_err(|e| e.to_string())?;

        let mut buf: Vec<u8> = vec![0u8; 74];
        let (len, _) = tokio::time::timeout(
                Duration::from_secs(5),
                self.udp_socket.recv_from(&mut buf)
            ).await.map_err(|_| "IP Discovery timeout")?.map_err(|e| e.to_string())?;

        if len < 74 {
            return Err("Invalid IP discovery response length".to_owned());
        }

        // Parse địa chỉ IP và Port từ phản hồi của server
        let client_ip: String = String::from_utf8_lossy(&buf[8..72]).trim_end_matches('\0').to_string();
        let client_port: u16 = u16::from_be_bytes([buf[72], buf[73]]);

        println!("[VoidCord Voice] IP Discovery success! External endpoint: {client_ip}:{client_port}");
        Ok(())
    }
}

fn timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}