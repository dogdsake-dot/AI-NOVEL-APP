# AI-NOVEL-APP Android wrapper

This package is a thin Capacitor Android shell around the upstream React client. The upstream Express/Prisma/LangGraph/RAG server remains unchanged except for allowing the Capacitor localhost origin.

## Runtime model

- Android APK: packaged upstream React client.
- Server: original `server/` application, running on a PC/server reachable by the phone.
- First launch: enter the server root URL, for example `http://192.168.1.10:3000`. The app stores it locally and appends `/api`.
- The floating **服务器** button lets you change the endpoint later.

## LAN server example

Use the upstream server configuration with `HOST=0.0.0.0` and `ALLOW_LAN=true`. Keep the phone and the server on the same network. For public deployment, follow the upstream security guidance and use HTTPS.

## License

The copied and modified upstream code remains under AGPL-3.0-only. See the repository `LICENSE` and `PORTING.md`.
