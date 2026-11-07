use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, OnceLock},
};

const MAX_LOG_LINES: usize = 2_000;

static LOG_LINES: OnceLock<Arc<Mutex<VecDeque<String>>>> = OnceLock::new();

fn log_lines() -> Arc<Mutex<VecDeque<String>>> {
    LOG_LINES
        .get_or_init(|| Arc::new(Mutex::new(VecDeque::new())))
        .clone()
}

pub fn append_logs(lines: &[String]) {
    match log_lines().lock() {
        Ok(mut log_lines) => {
            for line in lines {
                log_lines.push_back(line.clone());
            }
            while log_lines.len() > MAX_LOG_LINES {
                log_lines.pop_front();
            }
        }
        Err(error) => log::error!("GPUI console log buffer lock poisoned: {error}"),
    }
}

#[cfg(windows)]
mod windows {
    use super::{log_lines, VecDeque};
    use gpui::{
        div, prelude::*, px, rgb, size, App, Application, Bounds, Context, Render, Timer,
        TitlebarOptions, Window, WindowBounds, WindowOptions,
    };
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicIsize, Ordering},
            mpsc, Arc, Mutex,
        },
        thread,
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{FindWindowW, IsWindow, ShowWindow, SW_HIDE, SW_SHOW},
    };

    const WINDOW_TITLE: &str = "VoidCord GPUI Rust Console";

    static CONSOLE_HWND: AtomicIsize = AtomicIsize::new(0);
    static CONSOLE_STARTED: AtomicBool = AtomicBool::new(false);
    static CONSOLE_VISIBLE: AtomicBool = AtomicBool::new(false);

    struct ConsoleView {
        lines: Arc<Mutex<VecDeque<String>>>,
    }

    impl Render for ConsoleView {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let output = match self.lines.lock() {
                Ok(lines) => lines.iter().cloned().collect::<Vec<_>>().join("\n"),
                Err(_) => "The Rust log buffer is unavailable.".to_owned(),
            };

            div()
                .size_full()
                .flex()
                .flex_col()
                .bg(rgb(0x17151e))
                .child(
                    div()
                        .h(px(32.0))
                        .w_full()
                        .flex()
                        .items_center()
                        .px_3()
                        .bg(rgb(0x24212e))
                        .text_sm()
                        .text_color(rgb(0xe4e1eb))
                        .child("VoidCord Rust Console · GPUI prototype")
                        .child(div().flex_1())
                        .child(
                            div()
                                .id("hide-button")
                                .px_2()
                                .py_1()
                                .bg(rgb(0x373343))
                                .rounded_sm()
                                .child("Hide")
                                .on_click(cx.listener(|_, _, _, _| {
                                    let hwnd = CONSOLE_HWND.load(Ordering::SeqCst) as HWND;
                                    if !hwnd.is_null() {
                                        CONSOLE_VISIBLE.store(false, Ordering::SeqCst);
                                        unsafe {
                                            ShowWindow(hwnd, SW_HIDE);
                                        }
                                    }
                                })),
                        ),
                )
                .child(
                    div()
                        .id("console-output")
                        .flex_1()
                        .w_full()
                        .overflow_y_scroll()
                        .px_3()
                        .py_2()
                        .text_size(px(12.0))
                        .text_color(rgb(0xc8c4d2))
                        .child(output),
                )
        }
    }

    pub fn toggle(_app: &tauri::AppHandle) -> Result<(), String> {
        let existing = CONSOLE_HWND.load(Ordering::SeqCst) as HWND;
        if !existing.is_null() && unsafe { IsWindow(existing) } != 0 {
            let show = !CONSOLE_VISIBLE.load(Ordering::SeqCst);
            CONSOLE_VISIBLE.store(show, Ordering::SeqCst);
            unsafe {
                ShowWindow(existing, if show { SW_SHOW } else { SW_HIDE });
            }
            return Ok(());
        }

        if CONSOLE_STARTED
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("The GPUI Rust console is still starting; try again shortly".to_owned());
        }

        let lines = log_lines();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread_result = thread::Builder::new()
            .name("voidcord-gpui-console".to_owned())
            .spawn(move || {
                Application::new().run(move |cx: &mut App| {
                    let bounds =
                        Bounds::centered(None, size(px(800.0), px(480.0)), cx);
                    let titlebar = TitlebarOptions {
                        title: Some(WINDOW_TITLE.into()),
                        ..Default::default()
                    };
                    let window_result = cx.open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(bounds)),
                            titlebar: Some(titlebar),
                            show: true,
                            focus: true,
                            ..Default::default()
                        },
                        {
                            let lines = lines.clone();
                            move |_, cx| cx.new(|_| ConsoleView { lines })
                        },
                    );
                    if let Err(error) = window_result {
                        CONSOLE_STARTED.store(false, Ordering::SeqCst);
                        let _ =
                            ready_tx.send(Err(format!("Could not create GPUI console: {error}")));
                        return;
                    }

                    let child = match find_console_window() {
                        Some(child) => child,
                        None => {
                            CONSOLE_STARTED.store(false, Ordering::SeqCst);
                            let _ = ready_tx.send(Err(
                                "Could not locate the GPUI console window".to_owned(),
                            ));
                            return;
                        }
                    };

                    CONSOLE_HWND.store(child as isize, Ordering::SeqCst);
                    CONSOLE_VISIBLE.store(true, Ordering::SeqCst);
                    unsafe {
                        ShowWindow(child, SW_SHOW);
                    }

                    cx.spawn(async move |cx| loop {
                        Timer::after(Duration::from_millis(500)).await;
                        if CONSOLE_VISIBLE.load(Ordering::SeqCst) && cx.refresh().is_err() {
                            break;
                        }
                    })
                    .detach();
                    let _ = ready_tx.send(Ok(()));
                });
            });
        if let Err(error) = thread_result {
            CONSOLE_STARTED.store(false, Ordering::SeqCst);
            return Err(format!("Could not start GPUI console thread: {error}"));
        }

        match ready_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(result) => result,
            Err(error) => {
                CONSOLE_STARTED.store(false, Ordering::SeqCst);
                Err(format!("GPUI console did not initialize: {error}"))
            }
        }
    }

    fn find_console_window() -> Option<HWND> {
        let title = WINDOW_TITLE
            .encode_utf16()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
            if !hwnd.is_null() {
                return Some(hwnd);
            }
            thread::sleep(Duration::from_millis(25));
        }
        None
    }
}

#[cfg(windows)]
pub fn toggle(app: &tauri::AppHandle) -> Result<(), String> {
    windows::toggle(app)
}

#[cfg(not(windows))]
pub fn toggle(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("The GPUI Rust console is currently supported on Windows only".to_owned())
}
