# Mobile port notes

- Upstream: https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant
- Upstream desktop version at sync time: 0.4.19
- Mobile port version: 0.2.2
- Strategy: preserve the upstream product UI and API surface while replacing Android's remote server dependency with an in-app local compatibility runtime plus direct DeepSeek API execution.

## What is preserved

The original React client, Express server, Prisma database layer, LangChain/LangGraph agent runtime, RAG/Qdrant integration, world/character/outline/chapter pipelines, Creative Hub, automatic director, style engine, book analysis, comic/drama workshops, settings, model routing, task recovery and other upstream modules are retained from upstream source rather than reimplemented.

## Mobile-specific differences

Android is local-first: no server address is requested and the app does not require the upstream Express service at runtime. CRUD/project state, core novel workflow state, and Creation Studio task state are persisted locally; AI-oriented API calls are handled by the DeepSeek-only mobile adapter over Capacitor native HTTP. Packaged routing uses HashRouter and startup failures are surfaced visibly instead of producing a silent white screen. The desktop/server source is still retained in the repository for upstream parity and non-Android builds. Electron-only capabilities remain desktop-only.

## License and attribution

This is a modified version of AI Novel Writing Assistant. The upstream project is licensed AGPL-3.0-only under its default community license. The original LICENSE is retained. The upstream license file also states that service-style commercial/SaaS/hosted use requires separate commercial authorization from the maintainer.
