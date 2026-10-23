use std::{
    cmp::Reverse,
    collections::{HashMap, VecDeque},
    str::FromStr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use cacophony::{
    Connection, ConnectionConfig, ConnectionConnect, SpeakingFlags,
    opus::{
        Decoder,
        discord::{EncodeConfig, PacketEncoder, PcmFrame},
    },
};
use cpal::{
    Data, Device, DeviceId, SampleFormat, Stream, StreamConfig,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use rubato::{
    Async, FixedAsync, Resampler, SincInterpolationParameters,
    audioadapter_buffers::owned::InterleavedOwned,
};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

const VOICE_SAMPLE_RATE: u32 = 48_000;
const VOICE_CHANNELS: usize = 2;
const OPUS_SAMPLES_PER_FRAME: usize = 960 * VOICE_CHANNELS;
const CAPTURE_QUEUE_CAPACITY: usize = 2; // Keep capture backlog to a few callback periods
const OUTGOING_PACKET_QUEUE_CAPACITY: usize = 3; // At most 60 ms of queued Opus audio
const MAX_PLAYBACK_LATENCY_SAMPLES: usize = VOICE_SAMPLE_RATE as usize * VOICE_CHANNELS / 10; // Aggressive 100ms max buffer for real-time zero delay
const MAX_DECODERS: usize = 128;
const PLAYBACK_QUEUE_CAPACITY: usize = 32;

#[derive(Clone, Debug, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct AudioDeviceList {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

#[derive(Clone, Default)]
pub struct VoiceControlState {
    pub muted: Arc<AtomicBool>,
    pub deafened: Arc<AtomicBool>,
    pub generation: Arc<AtomicU64>,
}

pub struct VoiceGatewayConfig {
    pub endpoint: String,
    pub server_id: String,
    pub channel_id: String,
    pub user_id: String,
    pub session_id: String,
    pub token: String,
}

pub struct VoiceSession {
    connection: Connection,
    audio: AudioIo,
}

struct AudioIo {
    input: Option<Stream>,
    output: Stream,
    capture: Option<mpsc::Receiver<Vec<f32>>>,
    playback: Arc<Mutex<VecDeque<i16>>>,
    dropped_capture_chunks: Arc<AtomicUsize>,
    input_sample_rate: Option<u32>,
    output_sample_rate: u32,
}

impl VoiceSession {
    pub async fn connect(
        config: VoiceGatewayConfig,
        app: &AppHandle,
        deafened: Arc<AtomicBool>,
        input_device_id: Option<String>,
        output_device_id: Option<String>,
    ) -> Result<Self, String> {
        let server_id = parse_id("voice server", &config.server_id)?;
        let channel_id = parse_id("channel", &config.channel_id)?;
        let user_id = parse_id("user", &config.user_id)?;
        let connection = ConnectionConfig {
            guild_id: server_id,
            channel_id,
            user_id,
            session_id: config.session_id,
            token: config.token,
            endpoint: config.endpoint,
        }
        .connect()
        .await
        .map_err(|error| format!("Voice connection failed: {error}"))?;

        let audio = match AudioIo::open(app, deafened, input_device_id, output_device_id) {
            Ok(audio) => audio,
            Err(error) => {
                let _ = connection.close_and_wait().await;
                return Err(error);
            }
        };

        Ok(Self { connection, audio })
    }

    pub async fn close(self) {
        let _ = self.connection.close_and_wait().await;
    }

    pub async fn run(self, app: AppHandle, controls: VoiceControlState) -> Result<(), String> {
        let Self {
            connection,
            mut audio,
        } = self;
        let result = run_audio_session(&connection, &mut audio, &app, &controls).await;
        let close_result = connection
            .close_and_wait()
            .await
            .map_err(|error| format!("Could not close voice connection cleanly: {error}"));

        match result {
            Err(error) => Err(error),
            Ok(()) => close_result,
        }
    }
}

async fn run_audio_session(
    connection: &Connection,
    audio: &mut AudioIo,
    app: &AppHandle,
    controls: &VoiceControlState,
) -> Result<(), String> {
    let has_capture = audio.capture.is_some();
    let mut capture_receiver = audio.capture.as_mut();
    let playout = connection
        .start_opus_playout()
        .await
        .map_err(|error| format!("Could not start voice audio: {error}"))?;
    // Never await network/backpressure while servicing microphone capture.
    // Keep sending on a separate task so capture cannot accumulate stale audio.
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel(OUTGOING_PACKET_QUEUE_CAPACITY);
    let sender_app = app.clone();
    tokio::spawn(async move {
        while let Some(packet) = outgoing_rx.recv().await {
            if let Err(error) = playout.push_packet(packet).await {
                emit_voice_log(
                    &sender_app,
                    "error",
                    format!("Could not send microphone audio: {error}"),
                );
                break;
            }
        }
    });
    let mut frames = connection
        .frame_stream(4096)
        .await
        .map_err(|error| format!("Could not start incoming audio: {error}"))?;
    let mut encoder = PacketEncoder::new(EncodeConfig::default())
        .map_err(|error| format!("Could not create Opus encoder: {error}"))?;
    let mut decoders = HashMap::<u32, (Decoder, Instant)>::new();
    let mut input_converter = audio
        .input_sample_rate
        .map(|rate| StreamingAudioConverter::new(rate, VOICE_SAMPLE_RATE))
        .transpose()?;
    let mut output_converter =
        StreamingAudioConverter::new(VOICE_SAMPLE_RATE, audio.output_sample_rate)?;
    let mut captured_samples = Vec::<f32>::with_capacity(OPUS_SAMPLES_PER_FRAME * 2);
    let mut decoded_samples = Vec::<i16>::with_capacity(OPUS_SAMPLES_PER_FRAME * 2);
    let mut speaking_muted = controls.muted.load(Ordering::Relaxed);

    connection
        .set_speaking(
            if speaking_muted || !has_capture {
                SpeakingFlags::NONE
            } else {
                SpeakingFlags::MICROPHONE
            },
            0,
        )
        .map_err(|error| format!("Could not set voice speaking state: {error}"))?;

    let input_rate = audio
        .input_sample_rate
        .map(|rate| format!("{rate} Hz -> {VOICE_SAMPLE_RATE} Hz"))
        .unwrap_or_else(|| "no microphone".to_owned());
    let output_rate = if audio.output_sample_rate == VOICE_SAMPLE_RATE {
        format!("{} Hz", audio.output_sample_rate)
    } else {
        format!("{VOICE_SAMPLE_RATE} Hz -> {} Hz", audio.output_sample_rate)
    };
    emit_voice_status(
        app,
        "connected",
        &format!("Voice connected | mic {input_rate} | output {output_rate}"),
    );

    loop {
        tokio::select! {
            capture_chunk = async {
                match capture_receiver.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => std::future::pending::<Option<Vec<f32>>>().await,
                }
            } => {
                let Some(capture_chunk) = capture_chunk else {
                    return Err("Microphone capture stopped unexpectedly".to_owned());
                };

                let dropped = audio.dropped_capture_chunks.swap(0, Ordering::Relaxed);
                if dropped > 0 {
                    emit_voice_log(
                        app,
                        "warn",
                        format!("Microphone buffer overflow; dropped {dropped} audio chunks"),
                    );
                }

                if controls.muted.load(Ordering::Relaxed) {
                    captured_samples.clear();
                    continue;
                }
                
                let converted = if let Some(converter) = input_converter.as_mut() {
                    converter.process(capture_chunk)?
                } else {
                    capture_chunk
                };

                captured_samples.extend(converted);
                
                // If accumulated backlog is too high, drop old audio frames to clear latency instantly
                if captured_samples.len() > OPUS_SAMPLES_PER_FRAME * 4 {
                    let drain_len = captured_samples.len() - (OPUS_SAMPLES_PER_FRAME * 2);
                    captured_samples.drain(..drain_len);
                }

                while captured_samples.len() >= OPUS_SAMPLES_PER_FRAME {
                    let frame = PcmFrame::from_stereo_interleaved(
                        &captured_samples[..OPUS_SAMPLES_PER_FRAME],
                    )
                    .map_err(|error| format!("Invalid microphone audio frame: {error}"))?;
                    let packet = encoder
                        .encode_frame(frame)
                        .map_err(|error| format!("Could not encode microphone audio: {error}"))?;
                    // Never block the capture loop on network backpressure. The bounded
                    // queue limits outgoing buffering to about 60 ms; drop on overload.
                    if let Err(error) = outgoing_tx.try_send(packet) {
                        emit_voice_log(
                            app,
                            "warn",
                            match error {
                                mpsc::error::TrySendError::Full(_) =>
                                    "Outgoing voice queue full; dropped a microphone frame to avoid adding latency".to_owned(),
                                mpsc::error::TrySendError::Closed(_) =>
                                    "Outgoing voice sender stopped; microphone audio is no longer being sent".to_owned(),
                            },
                        );
                    }
                    captured_samples.drain(..OPUS_SAMPLES_PER_FRAME);
                }
            }
            incoming = frames.recv() => {
                let frame = match incoming {
                    Ok(f) => f,
                    Err(error) => {
                        emit_voice_log(app, "warn", format!("Voice frame stream lagging/disconnected: {error}"));
                        continue;
                    }
                };

                let ssrc = frame.rtp.ssrc;
                if !decoders.contains_key(&ssrc) {
                    if decoders.len() >= MAX_DECODERS {
                        if let Some(oldest_ssrc) = decoders
                            .iter()
                            .min_by_key(|(_, (_, last_used))| *last_used)
                            .map(|(ssrc, _)| *ssrc)
                        {
                            decoders.remove(&oldest_ssrc);
                        }
                    }
                    let decoder = Decoder::discord_default()
                        .map_err(|error| format!("Could not create Opus decoder: {error}"))?;
                    decoders.insert(ssrc, (decoder, Instant::now()));
                }
                
                let (decoder, last_used) = decoders
                    .get_mut(&ssrc)
                    .expect("decoder inserted for incoming SSRC");
                *last_used = Instant::now();

                if let Err(_decode_err) = decoder.decode_frame_into(frame, &mut decoded_samples) {
                    continue;
                }

                if controls.deafened.load(Ordering::Relaxed) {
                    continue;
                }
                let normalized_samples = decoded_samples
                    .iter()
                    .map(|sample| *sample as f32 / 32768.0)
                    .collect();
                let converted_samples = output_converter.process(normalized_samples)?;
                append_playback_samples(&audio.playback, &converted_samples)?;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                let muted = controls.muted.load(Ordering::Relaxed);
                if muted != speaking_muted {
                    speaking_muted = muted;
                    connection
                        .set_speaking(
                            if muted || !has_capture {
                                SpeakingFlags::NONE
                            } else {
                                SpeakingFlags::MICROPHONE
                            },
                            0,
                        )
                        .map_err(|error| format!("Could not update voice speaking state: {error}"))?;
                }
            }
        }
    }
}

impl AudioIo {
    fn open(
        app: &AppHandle,
        deafened: Arc<AtomicBool>,
        input_device_id: Option<String>,
        output_device_id: Option<String>,
    ) -> Result<Self, String> {
        let host = cpal::default_host();
        let output_device = resolve_device(&host, output_device_id, false)?
            .ok_or_else(|| "No audio output device is available".to_owned())?;
        let output_config = select_config(&output_device, false)?;
        let output_sample_rate = output_config.sample_rate();
        let playback = Arc::new(Mutex::new(VecDeque::with_capacity(PLAYBACK_QUEUE_CAPACITY)));
        let output = build_output_stream(
            &output_device,
            output_config.config(),
            output_config.sample_format(),
            output_config.channels() as usize,
            playback.clone(),
            deafened,
            app.clone(),
        )?;
        output
            .play()
            .map_err(|error| format!("Could not start audio output: {error}"))?;

        let dropped_capture_chunks = Arc::new(AtomicUsize::new(0));
        let input_device = resolve_device(&host, input_device_id, true)?;
        let (input, capture, input_sample_rate) = match input_device {
            Some(input_device) => {
                let input_config = select_config(&input_device, true)?;
                let input_sample_rate = input_config.sample_rate();
                let (capture_tx, capture_rx) = mpsc::channel(CAPTURE_QUEUE_CAPACITY);
                let input = build_input_stream(
                    &input_device,
                    input_config.config(),
                    input_config.sample_format(),
                    input_config.channels() as usize,
                    capture_tx,
                    dropped_capture_chunks.clone(),
                    app.clone(),
                )?;
                input
                    .play()
                    .map_err(|error| format!("Could not start microphone capture: {error}"))?;
                (Some(input), Some(capture_rx), Some(input_sample_rate))
            }
            None => {
                emit_voice_log(
                    app,
                    "warn",
                    "No microphone is available; joining in listen-only mode",
                );
                (None, None, None)
            }
        };

        Ok(Self {
            input,
            output,
            capture,
            playback,
            dropped_capture_chunks,
            input_sample_rate,
            output_sample_rate,
        })
    }
}

pub fn list_audio_devices() -> Result<AudioDeviceList, String> {
    let host = cpal::default_host();
    let inputs = host
        .input_devices()
        .map_err(|error| format!("Could not list microphone devices: {error}"))?
        .map(audio_device)
        .collect::<Result<Vec<_>, _>>()?;
    let outputs = host
        .output_devices()
        .map_err(|error| format!("Could not list speaker devices: {error}"))?
        .map(audio_device)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AudioDeviceList { inputs, outputs })
}

fn audio_device(device: Device) -> Result<AudioDevice, String> {
    Ok(AudioDevice {
        id: device
            .id()
            .map_err(|error| format!("Could not identify audio device: {error}"))?
            .to_string(),
        name: device
            .description()
            .map_err(|error| format!("Could not read audio device name: {error}"))?
            .name()
            .to_owned(),
    })
}

fn resolve_device(
    host: &cpal::Host,
    device_id: Option<String>,
    input: bool,
) -> Result<Option<Device>, String> {
    let Some(device_id) = device_id else {
        return Ok(if input {
            host.default_input_device()
        } else {
            host.default_output_device()
        });
    };
    let id = DeviceId::from_str(&device_id)
        .map_err(|error| format!("Invalid audio device selection: {error}"))?;
    let device = host.device_by_id(&id).ok_or_else(|| {
        format!(
            "Selected {} device is no longer available",
            device_kind(input)
        )
    })?;
    Ok(Some(device))
}

fn device_kind(input: bool) -> &'static str {
    if input { "microphone" } else { "speaker" }
}

fn select_config(device: &Device, input: bool) -> Result<cpal::SupportedStreamConfig, String> {
    let configs: Vec<_> = if input {
        device
            .supported_input_configs()
            .map_err(|error| format!("Could not inspect microphone formats: {error}"))?
            .collect()
    } else {
        device
            .supported_output_configs()
            .map_err(|error| format!("Could not inspect speaker formats: {error}"))?
            .collect()
    };
    configs
        .into_iter()
        .filter(|config| config.channels() > 0 && sample_format_score(config.sample_format()) > 0)
        .max_by_key(|config| {
            let channel_score = match config.channels() {
                2 => 3,
                1 => 2,
                _ => 1,
            };
            let preferred_rate =
                VOICE_SAMPLE_RATE.clamp(config.min_sample_rate(), config.max_sample_rate());
            (
                channel_score,
                sample_format_score(config.sample_format()),
                Reverse(preferred_rate.abs_diff(VOICE_SAMPLE_RATE)),
            )
        })
        .map(|config| {
            let sample_rate =
                VOICE_SAMPLE_RATE.clamp(config.min_sample_rate(), config.max_sample_rate());
            config.with_sample_rate(sample_rate)
        })
        .ok_or_else(|| {
            format!(
                "{} device does not support F32, I16, or U16 audio",
                if input { "Microphone" } else { "Audio output" }
            )
        })
}

fn sample_format_score(format: SampleFormat) -> u8 {
    match format {
        SampleFormat::F32 => 3,
        SampleFormat::I16 => 2,
        SampleFormat::U16 => 1,
        _ => 0,
    }
}

struct StreamingAudioConverter {
    resampler: Option<Async<f32>>,
    pending: Vec<f32>,
}

impl StreamingAudioConverter {
    fn new(input_rate: u32, output_rate: u32) -> Result<Self, String> {
        let resampler = if input_rate == output_rate {
            None
        } else {
            let chunk_frames = (input_rate as usize / 100).max(64); // Reduced chunk size for faster processing cycles
            Some(
                Async::<f32>::new_sinc(
                    output_rate as f64 / input_rate as f64,
                    1.0,
                    &SincInterpolationParameters::default(),
                    chunk_frames,
                    VOICE_CHANNELS,
                    FixedAsync::Input,
                )
                .map_err(|error| {
                    format!("Could not create audio sample-rate converter: {error}")
                })?,
            )
        };
        Ok(Self {
            resampler,
            pending: Vec::new(),
        })
    }

    fn process(&mut self, samples: Vec<f32>) -> Result<Vec<f32>, String> {
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(samples);
        };
        if samples.len() % VOICE_CHANNELS != 0 {
            return Err("Audio sample converter received an incomplete stereo frame".to_owned());
        }

        self.pending.extend(samples);
        let needed_samples = resampler.input_frames_next() * VOICE_CHANNELS;
        let mut output = Vec::new();
        while self.pending.len() >= needed_samples {
            let input_samples = self.pending.drain(..needed_samples).collect();
            let input = InterleavedOwned::new_from(
                input_samples,
                VOICE_CHANNELS,
                needed_samples / VOICE_CHANNELS,
            )
            .map_err(|error| format!("Invalid audio conversion input: {error}"))?;
            let converted = resampler
                .process(&input, None)
                .map_err(|error| format!("Could not convert audio sample rate: {error}"))?;
            output.extend(converted.take_data());
        }
        Ok(output)
    }
}

fn build_input_stream(
    device: &Device,
    config: StreamConfig,
    format: SampleFormat,
    channels: usize,
    capture: mpsc::Sender<Vec<f32>>,
    dropped: Arc<AtomicUsize>,
    app: AppHandle,
) -> Result<Stream, String> {
    let error_app = app.clone();
    device
        .build_input_stream_raw(
            config,
            format,
            move |data: &Data, _| {
                let samples = match format {
                    SampleFormat::F32 => data.as_slice::<f32>().map(|samples| samples.to_vec()),
                    SampleFormat::I16 => data.as_slice::<i16>().map(|samples| {
                        samples
                            .iter()
                            .map(|sample| *sample as f32 / 32768.0)
                            .collect()
                    }),
                    SampleFormat::U16 => data.as_slice::<u16>().map(|samples| {
                        samples
                            .iter()
                            .map(|sample| (*sample as f32 - 32768.0) / 32768.0)
                            .collect()
                    }),
                    _ => None,
                };
                let Some(samples) = samples else {
                    dropped.fetch_add(1, Ordering::Relaxed);
                    return;
                };

                let stereo = to_stereo(samples, channels);
                if capture.try_send(stereo).is_err() {
                    dropped.fetch_add(1, Ordering::Relaxed);
                }
            },
            move |error| {
                emit_voice_log(
                    &error_app,
                    "error",
                    format!("Microphone stream error: {error}"),
                )
            },
            None,
        )
        .map_err(|error| format!("Could not open microphone: {error}"))
}

fn build_output_stream(
    device: &Device,
    config: StreamConfig,
    format: SampleFormat,
    channels: usize,
    playback: Arc<Mutex<VecDeque<i16>>>,
    deafened: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<Stream, String> {
    let error_app = app.clone();
    device
        .build_output_stream_raw(
            config,
            format,
            move |data: &mut Data, _| {
                let Ok(mut playback) = playback.lock() else {
                    return;
                };
                let deafened = deafened.load(Ordering::Relaxed);
                match format {
                    SampleFormat::F32 => {
                        if let Some(output) = data.as_slice_mut::<f32>() {
                            write_output(output, channels, &mut playback, deafened, |sample| {
                                sample as f32 / 32768.0
                            });
                        }
                    }
                    SampleFormat::I16 => {
                        if let Some(output) = data.as_slice_mut::<i16>() {
                            write_output(output, channels, &mut playback, deafened, |sample| {
                                sample
                            });
                        }
                    }
                    SampleFormat::U16 => {
                        if let Some(output) = data.as_slice_mut::<u16>() {
                            write_output(output, channels, &mut playback, deafened, |sample| {
                                (sample as i32 + 32768).clamp(0, u16::MAX as i32) as u16
                            });
                        }
                    }
                    _ => {}
                }
            },
            move |error| {
                emit_voice_log(
                    &error_app,
                    "error",
                    format!("Speaker stream error: {error}"),
                )
            },
            None,
        )
        .map_err(|error| format!("Could not open audio output: {error}"))
}

fn to_stereo(samples: Vec<f32>, channels: usize) -> Vec<f32> {
    let frames = samples.len() / channels;
    let mut stereo = Vec::with_capacity(frames * VOICE_CHANNELS);
    for frame in samples.chunks_exact(channels) {
        let left = frame[0].clamp(-1.0, 1.0);
        let right = frame.get(1).copied().unwrap_or(left).clamp(-1.0, 1.0);
        stereo.extend_from_slice(&[left, right]);
    }
    stereo
}

fn write_output<T: Copy>(
    output: &mut [T],
    channels: usize,
    playback: &mut VecDeque<i16>,
    deafened: bool,
    convert: impl Fn(i16) -> T,
) {
    for frame in output.chunks_mut(channels) {
        frame.fill(convert(0));
        let left = playback.pop_front().unwrap_or(0);
        let right = playback.pop_front().unwrap_or(0);
        if deafened {
            continue;
        }
        if channels == 1 {
            frame[0] = convert(((left as i32 + right as i32) / 2) as i16);
        } else {
            frame[0] = convert(left);
            frame[1] = convert(right);
        }
    }
}

fn append_playback_samples(playback: &Mutex<VecDeque<i16>>, samples: &[f32]) -> Result<(), String> {
    let mut playback = playback
        .lock()
        .map_err(|_| "Audio playback buffer was poisoned".to_owned())?;
    
    playback.extend(
        samples
            .iter()
            .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16),
    );

    // Enforce ultra-low latency: aggressively drop stale audio buffers exceeding 100ms
    if playback.len() > MAX_PLAYBACK_LATENCY_SAMPLES {
        let drop_count = playback.len() - MAX_PLAYBACK_LATENCY_SAMPLES;
        playback.drain(0..drop_count);
    }
    Ok(())
}

fn parse_id(label: &str, value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|_| format!("Invalid Discord {label} ID"))
}

fn emit_voice_status(app: &AppHandle, status: &str, message: &str) {
    let _ = app.emit(
        "discord:voice_status",
        json!({ "status": status, "message": message }),
    );
    emit_voice_log(
        app,
        if status == "failed" { "error" } else { "info" },
        message,
    );
}

fn emit_voice_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "voidcord:rust-log",
        json!({
            "level": level,
            "target": "voice",
            "message": message.into(),
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_capture_is_duplicated_to_stereo() {
        assert_eq!(to_stereo(vec![-0.5, 0.25], 1), vec![-0.5, -0.5, 0.25, 0.25]);
    }

    #[test]
    fn deafened_playback_discards_queued_audio() {
        let mut playback = VecDeque::from([120, -120]);
        let mut output = [1.0_f32; 4];

        write_output(&mut output, 2, &mut playback, true, |sample| sample as f32);

        assert_eq!(output, [0.0; 4]);
        assert!(playback.is_empty());
    }

    #[test]
    fn converts_high_rate_audio_to_discord_rate() {
        let mut converter = StreamingAudioConverter::new(96_000, VOICE_SAMPLE_RATE).unwrap();
        let input = vec![0.25; 96_000 / 50 * VOICE_CHANNELS];

        let output = converter.process(input).unwrap();

        let output_frames = output.len() / VOICE_CHANNELS;
        assert!((900..=1_000).contains(&output_frames));
        assert!(output.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn converts_discord_audio_to_speaker_rate() {
        let mut converter = StreamingAudioConverter::new(VOICE_SAMPLE_RATE, 44_100).unwrap();
        let input = vec![0.25; VOICE_SAMPLE_RATE as usize / 50 * VOICE_CHANNELS];

        let output = converter.process(input).unwrap();

        let output_frames = output.len() / VOICE_CHANNELS;
        assert!((860..=900).contains(&output_frames));
        assert!(output.iter().all(|sample| sample.is_finite()));
    }

    #[test]
    fn matching_audio_rates_bypass_resampling() {
        let mut converter =
            StreamingAudioConverter::new(VOICE_SAMPLE_RATE, VOICE_SAMPLE_RATE).unwrap();
        let input = vec![0.25, -0.25, 0.5, -0.5];

        assert_eq!(converter.process(input.clone()).unwrap(), input);
    }
}