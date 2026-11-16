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
    }

    impl Default for DesktopShell {
        fn default() -> Self {
            Self { active_server: 0 }
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
                        .child(div().h(px(16.0)))
                        .child(server_button("V", 0, self.active_server == 0, cx))
                        .child(server_button("C", 1, self.active_server == 1, cx))
                        .child(server_button("R", 2, self.active_server == 2, cx))
                        .child(server_button("G", 3, self.active_server == 3, cx))
                        .child(server_button("…", 4, self.active_server == 4, cx)),
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
                                .text_color(rgb(TEXT))
                                .child(server_name),
                        )
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(
                            div()
                                .px_3()
                                .py_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("TEXT CHANNELS"),
                        )
                        .child(channel_row("#", "general", true))
                        .child(channel_row("#", "development", false))
                        .child(channel_row("#", "showcase", false))
                        .child(
                            div()
                                .px_3()
                                .py_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("VOICE CHANNELS"),
                        )
                        .child(channel_row("◖", "Lounge", false))
                        .child(channel_row("◖", "Co-working", false)),
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
                                .child(div().text_color(rgb(ACCENT)).child("#"))
                                .child(div().w(px(8.0)))
                                .child("general")
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
                                        .child("The native VoidCord shell"),
                                )
                                .child(div().h(px(12.0)))
                                .child(
                                    div()
                                        .text_size(px(13.0))
                                        .text_color(rgb(MUTED))
                                        .child("This is the first GPUI milestone. The Discord backend is not connected yet."),
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
                                        .child("Messaging will be wired to the shared Rust core in a later milestone…"),
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
                                .child("SERVER OVERVIEW"),
                        )
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(
                            div()
                                .px_3()
                                .py_3()
                                .text_size(px(12.0))
                                .text_color(rgb(TEXT))
                                .child(server_name),
                        )
                        .child(
                            div()
                                .px_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("Native UI prototype"),
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
                                .child("Milestone 1 · Shell"),
                        )
                        .child(
                            div()
                                .px_3()
                                .text_size(px(11.0))
                                .text_color(rgb(MUTED))
                                .child("No gateway, cache, voice, or account actions are connected in this prototype."),
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
                cx.notify();
            }))
    }

    fn channel_row(prefix: &'static str, name: &'static str, selected: bool) -> impl IntoElement {
        div()
            .w_full()
            .px_3()
            .py_2()
            .flex()
            .items_center()
            .bg(rgb(if selected { PANEL_HOVER } else { 0x1c1924 }))
            .text_size(px(13.0))
            .child(div().text_color(rgb(MUTED)).child(prefix))
            .child(div().w(px(8.0)))
            .child(name)
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
