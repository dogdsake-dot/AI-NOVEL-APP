# AI-NOVEL-APP Android

Android is now a local-first build of the upstream AI Novel Production Engine UI. It does not ask for or connect to an AI-NOVEL server address.

## Runtime

- UI: upstream React client, preserved as the primary product surface.
- Local data: stored in the app WebView IndexedDB.
- AI: direct DeepSeek API calls from the packaged app through Capacitor native HTTP.
- Provider scope: DeepSeek only on Android.
- Models: deepseek-v4-pro and deepseek-v4-flash.
- Configuration: enter the DeepSeek API Key in the mobile DeepSeek control/settings.
- Creation Studio: idea interpretation, direction regeneration, confirmation, project creation and short-story draft state are persisted locally.
- Startup: packaged builds use hash routing and a visible fatal-error fallback instead of a silent white screen.

The upstream server source remains vendored for desktop/upstream parity, but the Android runtime does not depend on that server.

## License

Modified upstream code remains AGPL-3.0-only. See LICENSE and PORTING.md.
