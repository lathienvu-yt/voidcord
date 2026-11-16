#[cfg(windows)]
mod app {
    use gpui::{div, ease_in_out, prelude::*, px, rgb, size, Animation, AnimationExt, App, Application, Bounds, Context, Render, TitlebarOptions, Window, WindowBounds, WindowOptions};
    use std::time::Duration;
    use serde_json::Value;
    use std::path::PathBuf;
    use voidcord_core::discord_router::{AccountIdentity, DiscordRouter, TokenManager};

    const BG: u32 = 0x17151e;
    const PANEL: u32 = 0x201d29;
    const HOVER: u32 = 0x302b3b;
    const ACCENT: u32 = 0x8b7cf6;
    const FG: u32 = 0xe9e5f2;
    const MUTED: u32 = 0x9993a8;
    const DIVIDER: u32 = 0x302c39;

    #[derive(Clone)]
    struct Guild { id: String, name: String }

    #[derive(Clone)]
    struct Channel { id: String, name: String, kind: u64, topic: Option<String> }

    #[derive(Clone)]
    struct Message { author: String, content: String, timestamp: String }

    #[derive(Clone)]
    struct Member { name: String, nickname: Option<String> }

    struct Account { username: String, token: String }

    pub struct DesktopShell {
        guilds: Vec<Guild>,
        channels: Vec<Channel>,
        messages: Vec<Message>,
        members: Vec<Member>,
        active_server: Option<usize>,
        active_channel: Option<usize>,
        username: String,
        loading_guilds: bool,
        loading_channels: bool,
        loading_messages: bool,
        loading_members: bool,
        started: bool,
        error: Option<String>,
        channel_error: Option<String>,
        message_error: Option<String>,
        member_error: Option<String>,
    }

    impl Default for DesktopShell {
        fn default() -> Self {
            Self {
                guilds: Vec::new(), channels: Vec::new(), messages: Vec::new(), active_server: None,
                active_channel: None, username: "Not connected".into(), members: Vec::new(),
                loading_guilds: false, loading_channels: false, loading_messages: false, loading_members: false, started: false,
                error: None, channel_error: None, message_error: None, member_error: None,
            }
        }
    }

    impl DesktopShell {
        fn load_guilds(&mut self, cx: &mut Context<Self>) {
            self.loading_guilds = true;
            self.error = None;
            cx.notify();
            cx.spawn(async move |this, cx| {
                let result = smol::unblock(fetch_guilds).await;
                let _ = this.update(cx, |this, cx| {
                    this.loading_guilds = false;
                    match result {
                        Ok((account, guilds)) => {
                            this.username = account.username;
                            this.guilds = guilds;
                            this.active_server = if this.guilds.is_empty() { None } else { Some(0) };
                            if let Some(guild) = this.guilds.first() {
                                this.load_channels(guild.id.clone(), cx);
                                this.load_members(guild.id.clone(), cx);
                            }
                        }
                        Err(error) => {
                            this.error = Some(error);
                            this.guilds.clear();
                            this.channels.clear();
                            this.active_server = None;
                        }
                    }
                    cx.notify();
                });
            }).detach();
        }

        fn load_channels(&mut self, guild_id: String, cx: &mut Context<Self>) {
            self.loading_channels = true;
            self.channel_error = None;
            self.channels.clear();
            self.messages.clear();
            self.active_channel = None;
            self.loading_messages = false;
            self.message_error = None;
            cx.notify();
            cx.spawn(async move |this, cx| {
                let result = smol::unblock(move || fetch_channels(guild_id)).await;
                let _ = this.update(cx, |this, cx| {
                    this.loading_channels = false;
                    match result {
                        Ok(channels) => {
                            this.channels = channels;
                            this.active_channel = if this.channels.is_empty() { None } else { Some(0) };
                            if let Some(channel) = this.channels.first() {
                                if channel.kind == 0 { this.load_messages(channel.id.clone(), cx); }
                            }
                        }
                        Err(error) => this.channel_error = Some(error),
                    }
                    cx.notify();
                });
            }).detach();
        }

        fn load_members(&mut self, guild_id: String, cx: &mut Context<Self>) {
            self.loading_members = true;
            self.member_error = None;
            self.members.clear();
            cx.notify();
            cx.spawn(async move |this, cx| {
                let result = smol::unblock(move || fetch_members(guild_id)).await;
                let _ = this.update(cx, |this, cx| {
                    this.loading_members = false;
                    match result {
                        Ok(members) => this.members = members,
                        Err(error) => this.member_error = Some(error),
                    }
                    cx.notify();
                });
            }).detach();
        }

        fn load_messages(&mut self, channel_id: String, cx: &mut Context<Self>) {
            self.loading_messages = true;
            self.message_error = None;
            self.messages.clear();
            cx.notify();
            cx.spawn(async move |this, cx| {
                let result = smol::unblock(move || fetch_messages(channel_id)).await;
                let _ = this.update(cx, |this, cx| {
                    this.loading_messages = false;
                    match result {
                        Ok(messages) => this.messages = messages,
                        Err(error) => this.message_error = Some(error),
                    }
                    cx.notify();
                });
            }).detach();
        }
    }

    impl Render for DesktopShell {
        fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            if !self.started {
                self.started = true;
                self.load_guilds(cx);
            }

            let server_name = self.active_server
                .and_then(|i| self.guilds.get(i))
                .map(|g| g.name.clone())
                .unwrap_or_else(|| "Servers".into());
            let active_channel = self.active_channel.and_then(|i| self.channels.get(i));
            let channel_name = active_channel.map(|c| c.name.clone()).unwrap_or_else(|| "Select a channel".into());
            let channel_topic = active_channel.and_then(|c| c.topic.clone()).unwrap_or_default();

            let server_items = self.guilds.iter().enumerate().map(|(i, guild)| {
                server_button(guild.name.clone(), i, self.active_server == Some(i), cx)
            }).collect::<Vec<_>>();
            let channel_items = self.channels.iter().enumerate().map(|(i, channel)| {
                channel_button(channel.name.clone(), channel.kind, i, self.active_channel == Some(i), cx)
            }).collect::<Vec<_>>();
            let message_items = self.messages.iter().map(|message| message_row(message.clone())).collect::<Vec<_>>();
            let member_items = self.members.iter().map(|member| member_row(member.clone())).collect::<Vec<_>>();

            div().size_full().flex().bg(rgb(BG)).text_color(rgb(FG))
                .child(
                    div().w(px(76.0)).h_full().flex().flex_col().items_center().py_3().gap_2().bg(rgb(PANEL))
                        .child(div().w(px(44.0)).h(px(44.0)).flex().items_center().justify_center().rounded_sm().bg(rgb(ACCENT)).text_color(rgb(0xffffff)).child("V"))
                        .child(div().h(px(8.0)))
                        .children(server_items)
                        .child(div().flex_1())
                        .child(div().id("account-refresh").w(px(38.0)).h(px(38.0)).flex().items_center().justify_center().rounded_full().bg(rgb(HOVER)).text_size(px(10.0)).child(initials(&self.username)).hover(|style| style.bg(rgb(ACCENT))).on_click(cx.listener(|this, _, _, cx| this.load_guilds(cx))))
                )
                .child(
                    div().w(px(248.0)).h_full().flex().flex_col().bg(rgb(0x1c1924))
                        .child(div().h(px(58.0)).w_full().flex().items_center().px_4().bg(rgb(PANEL)).child(server_name.clone()).child(div().flex_1()).child(div().px_2().py_1().rounded_sm().text_color(rgb(MUTED)).child("↻").hover(|style| style.bg(rgb(HOVER))).on_click(cx.listener(|this, _, _, cx| { if let Some(guild) = this.active_server.and_then(|i| this.guilds.get(i)) { let id = guild.id.clone(); this.load_channels(id.clone(), cx); this.load_members(id, cx); } }))).child("⌄"))
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(div().px_3().py_3().text_size(px(10.0)).text_color(rgb(MUTED)).child("CHANNELS"))
                        .when(self.loading_channels, |el| el.child(status("Loading channels…")).child(skeleton()).child(skeleton()).child(skeleton()))
                        .when(self.channel_error.is_some(), |el| el.child(status(self.channel_error.clone().unwrap_or_default())))
                        .when(!self.loading_channels && self.channels.is_empty() && self.channel_error.is_none(), |el| el.child(status("No channels to display")))
                        .children(channel_items)
                        .child(div().flex_1())
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(div().px_3().py_3().text_size(px(10.0)).text_color(rgb(MUTED)).child("EXPERIMENTAL GPUI CLIENT"))
                )
                .child(
                    div().flex_1().h_full().flex().flex_col()
                        .child(div().h(px(58.0)).w_full().flex().items_center().px_4().bg(rgb(PANEL))
                            .child(channel_icon(active_channel.map(|c| c.kind).unwrap_or(0)))
                            .child(div().w(px(8.0)))
                            .child(div().flex().flex_col().gap_1().child(channel_name.clone()).when(!channel_topic.is_empty(), |el| el.child(div().text_size(px(9.0)).text_color(rgb(MUTED)).child(channel_topic.clone()))))
                            .child(div().flex_1()).child(div().px_2().py_1().rounded_sm().text_size(px(12.0)).text_color(rgb(MUTED)).child("↻").hover(|style| style.bg(rgb(HOVER))).on_click(cx.listener(|this, _, _, cx| { if let Some(channel) = this.active_channel.and_then(|i| this.channels.get(i)) { this.load_messages(channel.id.clone(), cx); } }))).child(div().text_size(px(11.0)).text_color(rgb(MUTED)).child(self.username.clone())))
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(
                            div().id("message-history").flex_1().w_full().flex().flex_col().px_5().py_4().gap_3().overflow_y_scroll()
                                .when(self.loading_guilds, |el| el.child(status("Connecting to Discord…")).child(skeleton()).child(skeleton()))
                                .when(self.error.is_some(), |el| el.child(div().text_color(rgb(0xff8b8b)).child(self.error.clone().unwrap_or_default())).child(retry_button(cx)))
                                .when(!self.loading_guilds && self.error.is_none() && self.guilds.is_empty(), |el| el.child("No Discord servers found").child(status("Sign in using the stable VoidCord client, then retry.")))
                                .when(self.loading_messages, |el| el.child(status("Loading messages…")).child(skeleton()).child(skeleton()).child(skeleton()))
                                .when(self.message_error.is_some(), |el| el.child(div().text_color(rgb(0xff8b8b)).child(self.message_error.clone().unwrap_or_default())))
                                .when(!self.loading_messages && self.message_error.is_none() && self.messages.is_empty() && !self.guilds.is_empty(), |el| el.child(status("No messages yet — start the conversation.")))
                                .children(message_items)
                        )
                        .child(div().h(px(64.0)).w_full().flex().items_center().px_4().bg(rgb(PANEL)).child(div().flex_1().px_3().py_3().rounded_sm().bg(rgb(BG)).text_size(px(12.0)).text_color(rgb(MUTED)).child("Message composer is the next slice…")))
                )
                .child(
                    div().w(px(224.0)).h_full().flex().flex_col().bg(rgb(0x1c1924))
                        .child(div().h(px(58.0)).w_full().flex().items_center().px_3().bg(rgb(PANEL)).text_size(px(12.0)).child("CHANNEL DETAILS"))
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(div().px_3().py_3().text_size(px(13.0)).child(channel_name))
                        .child(div().px_3().text_size(px(11.0)).text_color(rgb(MUTED)).child(server_name))
                        .child(div().h(px(20.0)))
                        .child(div().px_3().text_size(px(11.0)).text_color(rgb(MUTED)).child("ACCOUNT"))
                        .child(div().px_3().py_2().text_size(px(12.0)).text_color(rgb(ACCENT)).child(self.username.clone()))
                        .child(div().px_3().text_size(px(11.0)).text_color(rgb(MUTED)).child(format!("Guilds: {}", self.guilds.len())))
                        .child(div().h(px(1.0)).w_full().bg(rgb(DIVIDER)))
                        .child(div().px_3().py_3().text_size(px(11.0)).text_color(rgb(MUTED)).child(format!("MEMBERS · {}", self.members.len())))
                        .when(self.loading_members, |el| el.child(status("Loading members…")).child(skeleton()).child(skeleton()))
                        .when(self.member_error.is_some(), |el| el.child(status(self.member_error.clone().unwrap_or_default())))
                        .when(!self.loading_members && self.member_error.is_none() && self.members.is_empty(), |el| el.child(status("No members to show")))
                        .children(member_items)
                )
                .with_animation("voidcord-shell-enter", Animation::new(Duration::from_millis(280)).with_easing(ease_in_out), |element, progress| element.opacity(progress))
        }
    }

    fn fetch_guilds() -> Result<(Account, Vec<Guild>), String> {
        let account = load_account()?;
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()
            .map_err(|e| format!("Could not start Discord runtime: {e}"))?;
        let router = DiscordRouter::new(TokenManager::default());
        let response = runtime.block_on(router.rest_with_auth(Some(&account.token), AccountIdentity::Primary, reqwest::Method::GET, "users/@me/guilds", None))
            .map_err(|e| format!("Could not load Discord servers: {e}"))?;
        let entries = response.as_array().ok_or_else(|| "Discord returned an unexpected server list.".to_owned())?;
        let guilds = entries.iter().filter_map(|item| Some(Guild {
            id: item.get("id")?.as_str()?.to_owned(),
            name: item.get("name")?.as_str()?.to_owned(),
        })).collect();
        Ok((account, guilds))
    }

    fn fetch_channels(guild_id: String) -> Result<Vec<Channel>, String> {
        let account = load_account()?;
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()
            .map_err(|e| format!("Could not start Discord runtime: {e}"))?;
        let router = DiscordRouter::new(TokenManager::default());
        let path = format!("guilds/{guild_id}/channels");
        let response = runtime.block_on(router.rest_with_auth(Some(&account.token), AccountIdentity::Primary, reqwest::Method::GET, &path, None))
            .map_err(|e| format!("Could not load channels: {e}"))?;
        let entries = response.as_array().ok_or_else(|| "Discord returned an unexpected channel list.".to_owned())?;
        let mut channels = entries.iter().filter_map(|item| Some(Channel {
            id: item.get("id")?.as_str()?.to_owned(),
            name: item.get("name")?.as_str()?.to_owned(),
            kind: item.get("type")?.as_u64()?,
            topic: item.get("topic").and_then(Value::as_str).map(str::to_owned),
        })).collect::<Vec<_>>();
        channels.sort_by_key(|channel| (channel.kind == 4, channel.kind == 2 || channel.kind == 13));
        Ok(channels)
    }

    fn fetch_members(guild_id: String) -> Result<Vec<Member>, String> {
        let account = load_account()?;
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()
            .map_err(|e| format!("Could not start Discord runtime: {e}"))?;
        let router = DiscordRouter::new(TokenManager::default());
        let path = format!("guilds/{guild_id}/members?limit=100");
        let response = runtime.block_on(router.rest_with_auth(
            Some(&account.token), AccountIdentity::ReadOnly, reqwest::Method::GET, &path, None
        )).map_err(|e| format!("Could not load server members: {e}"))?;
        let entries = response.as_array().ok_or_else(|| "Discord returned an unexpected member list.".to_owned())?;
        let mut members = entries.iter().filter_map(|item| {
            let user = item.get("user")?;
            let name = user.get("global_name").and_then(Value::as_str)
                .or_else(|| user.get("username").and_then(Value::as_str))?.to_owned();
            Some(Member { name, nickname: item.get("nick").and_then(Value::as_str).map(str::to_owned) })
        }).collect::<Vec<_>>();
        members.sort_by(|a, b| a.nickname.as_deref().unwrap_or(&a.name).to_lowercase().cmp(&b.nickname.as_deref().unwrap_or(&b.name).to_lowercase()));
        Ok(members)
    }

    fn fetch_messages(channel_id: String) -> Result<Vec<Message>, String> {
        let account = load_account()?;
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()
            .map_err(|e| format!("Could not start Discord runtime: {e}"))?;
        let router = DiscordRouter::new(TokenManager::default());
        let path = format!("channels/{channel_id}/messages?limit=50");
        let response = runtime.block_on(router.rest_with_auth(
            Some(&account.token), AccountIdentity::ReadOnly, reqwest::Method::GET, &path, None
        )).map_err(|e| format!("Could not load messages: {e}"))?;
        let entries = response.as_array().ok_or_else(|| "Discord returned an unexpected message list.".to_owned())?;
        let mut messages = entries.iter().filter_map(|item| {
            let author = item.get("author")?;
            Some(Message {
                author: author.get("global_name").and_then(Value::as_str)
                    .or_else(|| author.get("username").and_then(Value::as_str))
                    .unwrap_or("Unknown user").to_owned(),
                content: item.get("content").and_then(Value::as_str).unwrap_or("").to_owned(),
                timestamp: item.get("timestamp").and_then(Value::as_str).unwrap_or("").to_owned(),
            })
        }).collect::<Vec<_>>();
        messages.reverse();
        Ok(messages)
    }

    fn member_row(member: Member) -> impl IntoElement {
        let label = member.nickname.unwrap_or_else(|| member.name.clone());
        div().w_full().px_3().py_2().flex().items_center().gap_2()
            .hover(|style| style.bg(rgb(HOVER)))
            .child(div().w(px(26.0)).h(px(26.0)).rounded_full().flex().items_center().justify_center().bg(rgb(HOVER)).text_size(px(9.0)).text_color(rgb(ACCENT)).child(initials(&label)))
            .child(div().flex_1().text_size(px(12.0)).text_color(rgb(FG)).child(label))
    }

    fn message_row(message: Message) -> impl IntoElement {
        let stamp = message.timestamp.get(0..16).unwrap_or(&message.timestamp).replace('T', " ");
        div().w_full().flex().flex_col().gap_1().px_3().py_2().rounded_sm()
            .hover(|style| style.bg(rgb(0x211e2a)))
            .child(div().flex().items_center().gap_2()
                .child(div().text_size(px(13.0)).text_color(rgb(ACCENT)).child(message.author))
                .child(div().text_size(px(10.0)).text_color(rgb(MUTED)).child(stamp)))
            .child(div().text_size(px(13.0)).text_color(rgb(FG)).child(if message.content.is_empty() { "[Attachment or embedded message]".to_owned() } else { message.content }))
    }

    fn load_account() -> Result<Account, String> {
        let app_data = std::env::var_os("APPDATA").map(PathBuf::from)
            .ok_or_else(|| "Windows APPDATA directory is unavailable.".to_owned())?;
        let path = app_data.join("app.voidcord.desktop").join("voidcord-v1.json");
        let raw = std::fs::read_to_string(path)
            .map_err(|_| "No saved VoidCord account found. Sign in using the stable client first.".to_owned())?;
        let store: Value = serde_json::from_str(&raw).map_err(|_| "VoidCord account settings could not be read.".to_owned())?;
        let accounts = store.get("accounts").and_then(Value::as_array).ok_or_else(|| "No saved Discord accounts found.".to_owned())?;
        let active_id = store.get("active_account_id").and_then(Value::as_str);
        let selected = active_id.and_then(|id| accounts.iter().find(|a| a.pointer("/user/id").and_then(Value::as_str) == Some(id)))
            .or_else(|| accounts.iter().find(|a| a.get("role").and_then(Value::as_str) == Some("primary")))
            .or_else(|| accounts.first()).ok_or_else(|| "No saved Discord accounts found.".to_owned())?;
        let user = selected.get("user").ok_or_else(|| "Saved account metadata is incomplete.".to_owned())?;
        let id = user.get("id").and_then(Value::as_str).ok_or_else(|| "Saved account ID is missing.".to_owned())?;
        let username = user.get("global_name").and_then(Value::as_str)
            .or_else(|| user.get("username").and_then(Value::as_str)).unwrap_or("Discord account").to_owned();
        let entry = keyring::Entry::new("voidcord", &format!("discord_token_{id}"))
            .map_err(|e| format!("Could not access Windows credential storage: {e}"))?;
        let token = entry.get_password().map_err(|_| "The account token is missing from Windows Credential Manager. Sign in again in the stable client.".to_owned())?;
        Ok(Account { username, token })
    }

    fn initials(name: &str) -> String {
        name.split(|c: char| c.is_whitespace() || c == '_' || c == '-')
            .filter_map(|part| part.chars().next()).take(2).collect::<String>().to_uppercase()
    }

    fn server_button(name: String, index: usize, selected: bool, cx: &mut Context<DesktopShell>) -> impl IntoElement {
        div().id(("server", index)).w(px(44.0)).h(px(44.0)).flex().items_center().justify_center().rounded_sm()
            .bg(rgb(if selected { ACCENT } else { HOVER })).text_color(rgb(FG)).child(initials(&name))
            .hover(|style| style.bg(rgb(if selected { 0x9a8cff } else { 0x40394f })))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.active_server = Some(index);
                if let Some(guild) = this.guilds.get(index) {
                    this.load_channels(guild.id.clone(), cx);
                    this.load_members(guild.id.clone(), cx);
                }
                cx.notify();
            }))
            .with_animation(("server-entry", index), Animation::new(Duration::from_millis(220)).with_easing(ease_in_out), |element, progress| element.opacity(progress))
    }

    fn channel_icon(kind: u64) -> &'static str {
        match kind { 2 | 13 => "◖", 4 => "▾", 5 => "◉", 15 | 16 => "▤", 0 => "#", _ => "#" }
    }

    fn channel_button(name: String, kind: u64, index: usize, selected: bool, cx: &mut Context<DesktopShell>) -> impl IntoElement {
        let icon = channel_icon(kind);
        div().id(("channel", index)).w_full().px_3().py_2().flex().items_center().rounded_sm()
            .bg(rgb(if selected { HOVER } else { 0x1c1924 })).text_size(px(13.0))
            .text_color(rgb(if selected { FG } else { MUTED })).child(icon).child(div().w(px(8.0))).child(name)
            .hover(|style| style.bg(rgb(HOVER)))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.active_channel = Some(index);
                if let Some(channel) = this.channels.get(index) {
                    if channel.kind == 0 { this.load_messages(channel.id.clone(), cx); }
                    else { this.messages.clear(); this.message_error = Some("Message history is available for text channels.".into()); }
                }
                cx.notify();
            }))
            .with_animation(("channel-entry", index), Animation::new(Duration::from_millis(180)).with_easing(ease_in_out), |element, progress| element.opacity(progress))
    }

    fn status(message: impl Into<String>) -> impl IntoElement {
        div().px_3().py_2().text_size(px(11.0)).text_color(rgb(MUTED)).child(message.into())
    }

    fn skeleton() -> impl IntoElement {
        div().mx_3().my_1().h(px(28.0)).w(px(180.0)).rounded_sm().bg(rgb(HOVER))
            .with_animation("voidcord-loading-pulse", Animation::new(Duration::from_millis(850)).with_easing(ease_in_out), |element, progress| element.opacity(0.45 + progress * 0.55))
    }

    fn retry_button(cx: &mut Context<DesktopShell>) -> impl IntoElement {
        div().id("retry-discord").px_3().py_2().rounded_sm().bg(rgb(ACCENT)).text_color(rgb(0xffffff)).text_size(px(12.0)).child("Retry connection")
            .on_click(cx.listener(|this, _, _, cx| this.load_guilds(cx)))
    }

    pub fn run() {
        Application::new().run(|cx: &mut App| {
            let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
            let titlebar = TitlebarOptions { title: Some("VoidCord · GPUI".into()), ..Default::default() };
            cx.open_window(
                WindowOptions { window_bounds: Some(WindowBounds::Windowed(bounds)), titlebar: Some(titlebar), show: true, focus: true, ..Default::default() },
                |_, cx| cx.new(|_| DesktopShell::default()),
            ).expect("Could not open the VoidCord GPUI window");
        });
    }
}

#[cfg(windows)]
pub fn run() { app::run(); }

#[cfg(not(windows))]
pub fn run() { eprintln!("The experimental GPUI desktop shell currently targets Windows only."); }
