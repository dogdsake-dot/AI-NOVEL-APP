import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, content) => {
  const full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
};

const desktopPkg = JSON.parse(read("desktop/package.json"));
const upstreamVersion = String(desktopPkg.version || "0.0.0");
const mobileVersion = read(".porting/mobile-version.txt").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(mobileVersion)) {
  throw new Error(`Invalid mobile version: ${mobileVersion}`);
}

// 1) Keep the upstream monorepo intact and add one mobile package.
let workspace = read("pnpm-workspace.yaml");
if (!/^\s*- mobile\s*$/m.test(workspace)) {
  workspace = workspace.replace(/(packages:\s*\n)/, "$1  - mobile\n");
  write("pnpm-workspace.yaml", workspace);
}

const rootPkg = JSON.parse(read("package.json"));
rootPkg.scripts = {
  ...rootPkg.scripts,
  "build:mobile:web": "pnpm --filter @ai-novel/shared build && AI_NOVEL_CLIENT_BASE=relative VITE_MOBILE_BUILD=true pnpm --filter @ai-novel/client build",
  "mobile:add:android": "pnpm --dir mobile exec cap add android",
  "mobile:sync": "pnpm --dir mobile exec cap sync android",
  "mobile:build:debug": "pnpm run build:mobile:web && pnpm run mobile:sync && cd mobile/android && ./gradlew assembleDebug"
};
write("package.json", `${JSON.stringify(rootPkg, null, 2)}\n`);

// 2) Inject a very small mobile runtime adapter before React starts.
//    It leaves all normal web/desktop behavior unchanged.
const mobileRuntimeScript = `
    <!-- AI-NOVEL-APP mobile runtime adapter: start -->
    <script>
      (() => {
        if ("%VITE_MOBILE_BUILD%" !== "true") return;
        const STORAGE_KEY = "ai-novel.mobile.apiBaseUrl";
        const normalize = (value) => {
          const trimmed = String(value || "").trim().replace(/\\/$/, "");
          if (!trimmed) return "";
          return /\\/api$/i.test(trimmed) ? trimmed : trimmed + "/api";
        };
        let apiBaseUrl = normalize(localStorage.getItem(STORAGE_KEY));
        if (!apiBaseUrl) {
          const entered = window.prompt(
            "首次运行需要连接 AI Novel 服务端。\\n请输入服务端地址，例如：http://192.168.1.10:3000\\n（模拟器可用 http://10.0.2.2:3000）",
            ""
          );
          apiBaseUrl = normalize(entered);
          if (apiBaseUrl) localStorage.setItem(STORAGE_KEY, apiBaseUrl);
        }
        if (!apiBaseUrl) apiBaseUrl = "http://10.0.2.2:3000/api";
        window.__AI_NOVEL_RUNTIME__ = {
          ...(window.__AI_NOVEL_RUNTIME__ || {}),
          mode: "web",
          apiBaseUrl,
          isPackaged: true,
          updateChannel: "mobile"
        };
        window.addEventListener("DOMContentLoaded", () => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "服务器";
          button.setAttribute("aria-label", "设置 AI Novel 服务端地址");
          Object.assign(button.style, {
            position: "fixed",
            right: "12px",
            bottom: "12px",
            zIndex: "2147483647",
            border: "1px solid rgba(127,127,127,.35)",
            borderRadius: "999px",
            padding: "8px 12px",
            background: "rgba(15,23,42,.88)",
            color: "#fff",
            fontSize: "12px",
            lineHeight: "1",
            boxShadow: "0 4px 16px rgba(0,0,0,.18)"
          });
          button.addEventListener("click", () => {
            const current = localStorage.getItem(STORAGE_KEY) || "";
            const entered = window.prompt("AI Novel 服务端地址", current.replace(/\\/api$/i, ""));
            if (entered === null) return;
            const next = normalize(entered);
            if (!next) return;
            localStorage.setItem(STORAGE_KEY, next);
            window.location.reload();
          });
          document.body.appendChild(button);
        });
      })();
    </script>
    <!-- AI-NOVEL-APP mobile runtime adapter: end -->`;

let indexHtml = read("client/index.html");
if (!indexHtml.includes("AI-NOVEL-APP mobile runtime adapter: start")) {
  indexHtml = indexHtml.replace("    <title>AI 小说创作工作台 | AI Novel Production Engine</title>", `    <title>AI 小说创作工作台 | AI Novel Production Engine</title>${mobileRuntimeScript}`);
  write("client/index.html", indexHtml);
}

// 3) Allow the packaged Capacitor WebView to call the original server.
let serverApp = read("server/src/app.ts");
if (!serverApp.includes("isCapacitorOrigin")) {
  const oldLocal = '        const isLocalhostDevOrigin = /^http:\\\/\\\\/(localhost|127\\\\.0\\\\.0\\\\.1):\\\\d+$/.test(origin);';
  const newLocal = '        const isLocalhostDevOrigin = /^https?:\\\\/\\\\/(localhost|127\\\\.0\\\\.0\\\\.1)(?::\\\\d+)?$/.test(origin);\\n        const isCapacitorOrigin = /^(?:capacitor:\\\/\\\\/|https?:\\\\/\\\\/)localhost(?::\\\\d+)?$/.test(origin);';
  if (!serverApp.includes(oldLocal)) {
    throw new Error("Could not locate upstream localhost CORS rule; upstream changed and the mobile patch needs review.");
  }
  serverApp = serverApp.replace(oldLocal, newLocal);
  serverApp = serverApp.replace(
    "        callback(null, isListedOrigin || isLocalhostDevOrigin || isLanOrigin);",
    "        callback(null, isListedOrigin || isLocalhostDevOrigin || isLanOrigin || isCapacitorOrigin);"
  );
  write("server/src/app.ts", serverApp);
}

// 4) Capacitor wrapper. The React UI and all business logic remain upstream code.
write("mobile/package.json", `${JSON.stringify({
  name: "@ai-novel/mobile",
  version: mobileVersion,
  private: true,
  license: "AGPL-3.0-only",
  scripts: {
    "add:android": "cap add android",
    sync: "cap sync android",
    open: "cap open android"
  },
  dependencies: {
    "@capacitor/android": "^7.4.3",
    "@capacitor/core": "^7.4.3"
  },
  devDependencies: {
    "@capacitor/cli": "^7.4.3",
    typescript: "^5.9.3"
  }
}, null, 2)}\n`);

write("mobile/capacitor.config.ts", `import type { CapacitorConfig } from "@capacitor/cli";\n\nconst config: CapacitorConfig = {\n  appId: "com.dogdsake.ainovelapp",\n  appName: "AI Novel App",\n  webDir: "../client/dist",\n  server: {\n    androidScheme: "https",\n    cleartext: true\n  },\n  android: {\n    allowMixedContent: true\n  }\n};\n\nexport default config;\n`);

write("mobile/.gitignore", `.gradle/\nandroid/.gradle/\nandroid/local.properties\nandroid/app/build/\nandroid/build/\n`);

write("mobile/README.md", `# AI-NOVEL-APP Android wrapper\n\nThis package is a thin Capacitor Android shell around the upstream React client. The upstream Express/Prisma/LangGraph/RAG server remains unchanged except for allowing the Capacitor localhost origin.\n\n## Runtime model\n\n- Android APK: packaged upstream React client.\n- Server: original \`server/\` application, running on a PC/server reachable by the phone.\n- First launch: enter the server root URL, for example \`http://192.168.1.10:3000\`. The app stores it locally and appends \`/api\`.\n- The floating **服务器** button lets you change the endpoint later.\n\n## LAN server example\n\nUse the upstream server configuration with \`HOST=0.0.0.0\` and \`ALLOW_LAN=true\`. Keep the phone and the server on the same network. For public deployment, follow the upstream security guidance and use HTTPS.\n\n## License\n\nThe copied and modified upstream code remains under AGPL-3.0-only. See the repository \`LICENSE\` and \`PORTING.md\`.\n`);

const portingDoc = `# Mobile port notes\n\n- Upstream: https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant\n- Upstream desktop version at sync time: ${upstreamVersion}\n- Mobile port version: ${mobileVersion}\n- Strategy: vendor upstream source, preserve all core business logic, add a Capacitor Android shell and the minimum compatibility patches needed for a packaged WebView.\n\n## What is preserved\n\nThe original React client, Express server, Prisma database layer, LangChain/LangGraph agent runtime, RAG/Qdrant integration, world/character/outline/chapter pipelines, Creative Hub, automatic director, style engine, book analysis, comic/drama workshops, settings, model routing, task recovery and other upstream modules are retained from upstream source rather than reimplemented.\n\n## Mobile-specific differences\n\nElectron-only capabilities (Windows installer/updater and Electron shell integrations) do not run on Android. The Android client connects to the original server over LAN/HTTPS. Core novel-production features therefore remain server-backed and available on mobile, while desktop-shell-only behavior is intentionally excluded.\n\n## License and attribution\n\nThis is a modified version of AI Novel Writing Assistant. The upstream project is licensed AGPL-3.0-only under its default community license. The original LICENSE is retained. The upstream license file also states that service-style commercial/SaaS/hosted use requires separate commercial authorization from the maintainer.\n`;
write("PORTING.md", portingDoc);

let readme = read("README.md");
const start = "<!-- AI-NOVEL-APP-MOBILE-NOTICE:START -->";
const end = "<!-- AI-NOVEL-APP-MOBILE-NOTICE:END -->";
const notice = `${start}\n> **AI-NOVEL-APP Android port** — This repository tracks and vendors the upstream AI Novel Writing Assistant source, preserving upstream features while adding an Android Capacitor shell. Current synchronized upstream desktop version: **${upstreamVersion}**. Android release line: **${mobileVersion}**. See [PORTING.md](./PORTING.md).\n${end}\n\n`;
if (readme.includes(start) && readme.includes(end)) {
  readme = readme.replace(new RegExp(`${start}[\\s\\S]*?${end}\\n*`), notice);
} else {
  readme = notice + readme;
}
write("README.md", readme);

let gitignore = fs.existsSync(path.join(root, ".gitignore")) ? read(".gitignore") : "";
for (const line of ["mobile/android/.gradle/", "mobile/android/app/build/", "mobile/android/build/", "mobile/android/local.properties"]) {
  if (!gitignore.split(/\r?\n/).includes(line)) gitignore += `${gitignore.endsWith("\n") || !gitignore ? "" : "\n"}${line}\n`;
}
write(".gitignore", gitignore);

write("MOBILE_VERSION", `${mobileVersion}\n`);
console.log(`Applied Android port overlay for upstream ${upstreamVersion}; mobile version ${mobileVersion}`);
