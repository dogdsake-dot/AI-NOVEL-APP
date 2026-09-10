# Mobile port notes

- Upstream: https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant
- Upstream desktop version at sync time: 0.4.19
- Mobile port version: 0.2.0
- Strategy: vendor upstream source, preserve all core business logic, add a Capacitor Android shell and the minimum compatibility patches needed for a packaged WebView.

## What is preserved

The original React client, Express server, Prisma database layer, LangChain/LangGraph agent runtime, RAG/Qdrant integration, world/character/outline/chapter pipelines, Creative Hub, automatic director, style engine, book analysis, comic/drama workshops, settings, model routing, task recovery and other upstream modules are retained from upstream source rather than reimplemented.

## Mobile-specific differences

Electron-only capabilities (Windows installer/updater and Electron shell integrations) do not run on Android. The Android client connects to the original server over LAN/HTTPS. Core novel-production features therefore remain server-backed and available on mobile, while desktop-shell-only behavior is intentionally excluded.

## License and attribution

This is a modified version of AI Novel Writing Assistant. The upstream project is licensed AGPL-3.0-only under its default community license. The original LICENSE is retained. The upstream license file also states that service-style commercial/SaaS/hosted use requires separate commercial authorization from the maintainer.
