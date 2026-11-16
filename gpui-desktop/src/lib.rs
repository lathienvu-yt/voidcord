#[cfg(windows)]
mod app {
    use gpui::{
        div, prelude::*, px, rgb, size, App, Application, Bounds, Context, Render,
        TitlebarOptions, Window, WindowBounds, WindowOptions,
    };

    const BACKGROUND: u32 = 0x17151e;
    const PANEL: u32 = 0x201d29;
    const PANEL_HOVER: u32 = 0x302b3b;
    const ACCENT: u32 = 0x8b7cf6;
    const TEXT: u32 = 0xe9e5f2;
    const MUTED: u32 = 0x9993a8;
    const DIVIDER: u32 = 0x302c39;

    pub struct DesktopShell {
        active_server: usize,
        active_channel: usize,
        text_channels_open: bool,
        voice_channels_open: bool,
    }

    impl Default for DesktopShell {
        fn default() -> Self {
            Self {
                active_server: 0,
                active_channel: 0,
                text_channels_open: true,
                voice_channels_open: true,
            }
        }
    }

    impl Render for DesktopShell {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let server_name = match self.active_server {
                0 => "VoidCord HQ",
                1 => "Creator Hub",
                2 => "Rustaceans",
                3 => "Game Dev",
                _ => "Community",
            };
            let channel_name = match self.active_channel {
                0 => "general",
                1 => "development",
                2 => "showcase",
                3 => "Lounge",
                _ => "Co-working",
            };

            div()
                .size_full()
                .flex()
                .bg(rgb(BACKGROUND))
                .text_color(rgb(TEXT))
                // Server rail
                .child(
                    div()
                        .w(px(76.0))
                        .h_full()
                        .flex()
                        .flex_col()
                        .items_center()
                        .py_3()
                        .gap_2()
                        .bg(rgb(PANEL))
                        .child(
                            div()
                                .w(px(44.0))
                                .h(px(44.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_sm()
                                .bg(rgb(ACCENT))
                                .text_color(rgb(0xffffff))
                                .child("V"),
                        )
                        .child(div().h(px(8.0)))
                        .child(server_button("V", 0, self.active_server == 0, cx))
                        .child(server_button("C", 1, self.active_server == 1, cx))
                        .child(server_button("R", 2, self.active_server == 2, cx))
                        .child(server_button("G", 3, self.active_server == 3, cx))
                        .child(server_button("…", 4, self.active_server == 4, cx))
                        .child(div().flex_1())
                        .child(
                            div()
                                .w(px(38.0))
                                .h(px(38.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .bg(rgb(0x3a3547))
                                .text_size(px(12.0))
                                .child("LV"),
                        ),
                )
                // Channel list
                .child(
                    div()
                        .w(px(248.0))
                        .h_full()
                        .flex()
                        .flex_col()
                        .bg(rgb(0x1c1924))
                        .child(
                            div()
                                .h(px(58.0))
                                .w_full()
                                .flex()
                                .items_center()
                                .px_4()
                                .bg(rgb(PANEL))
                                .child(server_name)
                                .child(div().flex_1())
                                .child(div().text_color(rgb(MUTED)).child("⌄")),
                        )
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(category_header("TEXT CHANNELS", self.text_channels_open, true, cx))
                        .when(self.text_channels_open, |this| {
                            this.child(channel_button("#", "general", 0, self.active_channel, cx))
                                .child(channel_button("#", "development", 1, self.active_channel, cx))
                                .child(channel_button("#", "showcase", 2, self.active_channel, cx))
                        })
                        .child(category_header("VOICE CHANNELS", self.voice_channels_open, false, cx))
                        .when(self.voice_channels_open, |this| {
                            this.child(channel_button("◖", "Lounge", 3, self.active_channel, cx))
                                .child(channel_button("◖", "Co-working", 4, self.active_channel, cx))
                        })
                        .child(div().flex_1())
                        .child(
                            div()
                                .h(px(1.0))
                                .w_full()
                                .bg(rgb(DIVIDER)),
                        )
                        .child(
                            div()
                                .px_3()
                                .py_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("EXPERIMENTAL GPUI CLIENT"),
                        ),
                )
                // Main conversation area
                .child(
                    div()
                        .flex_1()
                        .h_full()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .h(px(58.0))
                                .w_full()
                                .flex()
                                .items_center()
                                .px_4()
                                .bg(rgb(PANEL))
                                .child(div().text_color(rgb(ACCENT)).child(if self.active_channel < 3 { "#" } else { "◖" }))
                                .child(div().w(px(8.0)))
                                .child(channel_name)
                                .child(div().flex_1())
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(rgb(MUTED))
                                        .child("GPUI native preview"),
                                ),
                        )
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(
                            div()
                                .flex_1()
                                .w_full()
                                .flex()
                                .flex_col()
                                .justify_center()
                                .items_center()
                                .px_6()
                                .child(
                                    div()
                                        .text_size(px(24.0))
                                        .text_color(rgb(TEXT))
                                        .child(format!("#{channel_name}")),
                                )
                                .child(div().h(px(12.0)))
                                .child(
                                    div()
                                        .text_size(px(13.0))
                                        .text_color(rgb(MUTED))
                                        .child(format!("You're viewing {channel_name} in {server_name}.")),
                                )
                                .child(div().h(px(24.0)))
                                .child(
                                    div()
                                        .px_3()
                                        .py_2()
                                        .rounded_sm()
                                        .bg(rgb(PANEL_HOVER))
                                        .text_size(px(12.0))
                                        .text_color(rgb(ACCENT))
                                        .child("Native window · no WebView"),
                                ),
                        )
                        .child(
                            div()
                                .h(px(64.0))
                                .w_full()
                                .flex()
                                .items_center()
                                .px_4()
                                .bg(rgb(PANEL))
                                .child(
                                    div()
                                        .flex_1()
                                        .px_3()
                                        .py_3()
                                        .rounded_sm()
                                        .bg(rgb(BACKGROUND))
                                        .text_size(px(12.0))
                                        .text_color(rgb(MUTED))
                                        .child("Messaging is the next subsystem to port…"),
                                ),
                        ),
                )
                // Right-hand context panel
                .child(
                    div()
                        .w(px(224.0))
                        .h_full()
                        .flex()
                        .flex_col()
                        .bg(rgb(0x1c1924))
                        .child(
                            div()
                                .h(px(58.0))
                                .w_full()
                                .flex()
                                .items_center()
                                .px_3()
                                .bg(rgb(PANEL))
                                .text_size(px(12.0))
                                .child("CHANNEL DETAILS"),
                        )
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(
                            div()
                                .px_3()
                                .py_3()
                                .text_size(px(13.0))
                                .text_color(rgb(TEXT))
                                .child(channel_name),
                        )
                        .child(
                            div()
                                .px_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child(server_name),
                        )
                        .child(div().h(px(20.0)))
                        .child(
                            div()
                                .px_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("MIGRATION STATUS"),
                        )
                        .child(
                            div()
                                .px_3()
                                .py_2()
                                .text_size(px(12.0))
                                .text_color(rgb(ACCENT))
                                .child("Milestone 2 · Navigation"),
                        )
                        .child(
                            div()
                                .px_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("Server and channel navigation are interactive. Discord data is not connected yet."),
                        ),
                )
        }
    }

    fn server_button(
        label: &'static str,
        index: usize,
        selected: bool,
        cx: &mut Context<DesktopShell>,
    ) -> impl IntoElement {
        div()
            .id(("server", index))
            .w(px(44.0))
            .h(px(44.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_sm()
            .bg(rgb(if selected { ACCENT } else { PANEL_HOVER }))
            .text_color(rgb(TEXT))
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| {
                this.active_server = index;
                this.active_channel = 0;
                cx.notify();
            }))
    }

    fn category_header(
        label: &'static str,
        expanded: bool,
        is_text: bool,
        cx: &mut Context<DesktopShell>,
    ) -> impl IntoElement {
        div()
            .id(if is_text { "text-category" } else { "voice-category" })
            .w_full()
            .px_3()
            .py_3()
            .flex()
            .items_center()
            .text_size(px(11.0))
            .text_color(rgb(MUTED))
            .child(if expanded { "⌄" } else { "›" })
            .child(div().w(px(6.0)))
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| {
                if is_text {
                    this.text_channels_open = !this.text_channels_open;
                } else {
                    this.voice_channels_open = !this.voice_channels_open;
                }
                cx.notify();
            }))
    }

    fn channel_button(
        prefix: &'static str,
        name: &'static str,
        index: usize,
        active_channel: usize,
        cx: &mut Context<DesktopShell>,
    ) -> impl IntoElement {
        let selected = index == active_channel;
        div()
            .id(("channel", index))
            .w_full()
            .px_3()
            .py_2()
            .flex()
            .items_center()
            .rounded_sm()
            .bg(rgb(if selected { PANEL_HOVER } else { 0x1c1924 }))
            .text_size(px(13.0))
            .text_color(rgb(if selected { TEXT } else { MUTED }))
            .child(div().text_color(rgb(MUTED)).child(prefix))
            .child(div().w(px(8.0)))
            .child(name)
            .on_click(cx.listener(move |this, _, _, cx| {
                this.active_channel = index;
                cx.notify();
            }))
    }

    pub fn run() {
        Application::new().run(|cx: &mut App| {
            let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
            let titlebar = TitlebarOptions {
                title: Some("VoidCord · GPUI".into()),
                ..Default::default()
            };

            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(titlebar),
                    show: true,
                    focus: true,
                    ..Default::default()
                },
                |_, cx| cx.new(|_| DesktopShell::default()),
            )
            .expect("Could not open the VoidCord GPUI window");
        });
    }
}

#[cfg(windows)]
pub fn run() {
    app::run();
}

#[cfg(not(windows))]
pub fn run() {
    eprintln!("The experimental GPUI desktop shell currently targets Windows only.");
}
