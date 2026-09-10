import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, content) => {
  const full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
};

// Restore the local-first runtime files after rsync --delete refreshes client/ from upstream.
// Copy the source into the client package instead of re-exporting files from .porting/.
// This keeps TypeScript/module resolution inside client/, where axios/idb-keyval are installed.
const localRuntime = read(".porting/mobile-local-runtime.ts")
  .replace("export const localApiAdapter: AxiosAdapter = async (config) => {", "export const localApiAdapter: AxiosAdapter = async (config: any) => {")
  .replace("const current = getDeepSeekApiKey();", "const current = getDeepSeekKey();")
  .replace('thinking: { type: "enabled", reasoning_effort: "high" },', 'thinking: { type: "enabled" },\n      reasoning_effort: "high",');
const apiAdapter = read(".porting/mobile-api-adapter.ts")
  .replace('from "./mobile-local-runtime";', 'from "./localRuntime";')
  .replace("export const mobileApiAdapter: AxiosAdapter = async (config) => {", "export const mobileApiAdapter: AxiosAdapter = async (config: any) => {");
const workflowAdapter = read(".porting/mobile-workflow-adapter.ts")
  .replace("  const normalized = {\n    novelId,\n    workspaceVersion: \"v2\",", "  const normalized: Record<string, any> = {\n    novelId,\n    workspaceVersion: \"v2\",");
write("client/src/mobile/localRuntime.ts", localRuntime);
write("client/src/mobile/apiAdapter.ts", apiAdapter);
write("client/src/mobile/extensions.ts", read(".porting/mobile-local-extensions.ts"));
write("client/src/mobile/workflowAdapter.ts", workflowAdapter);
write("client/src/mobile/creationAdapter.ts", read(".porting/mobile-creation-adapter.ts"));
write("client/src/api/client.ts", read(".porting/mobile-client.ts"));
write("client/src/main.tsx", read(".porting/mobile-main.tsx"));

// Replace the old mobile server-address bootstrap with a local runtime marker.
let html = read("client/index.html");
html = html.replace(/\n\s*<!-- AI-NOVEL-APP mobile runtime adapter: start -->[\s\S]*?<!-- AI-NOVEL-APP mobile runtime adapter: end -->\n?/m, "\n");
const marker = `\n    <!-- AI-NOVEL-APP local-first mobile runtime: start -->\n    <script>\n      (() => {\n        if (\"%VITE_MOBILE_BUILD%\" !== \"true\") return;\n        window.__AI_NOVEL_RUNTIME__ = {\n          ...(window.__AI_NOVEL_RUNTIME__ || {}),\n          mode: \"web\",\n          localFirst: true,\n          apiBaseUrl: \"local://api\",\n          isPackaged: true,\n          updateChannel: \"mobile\"\n        };\n        const reportFatal = (reason) => {\n          window.setTimeout(() => {\n            const root = document.getElementById(\"root\");\n            if (!root || root.textContent?.trim()) return;\n            root.replaceChildren();\n            const box = document.createElement(\"div\");\n            box.style.cssText = \"min-height:100vh;padding:32px;background:#090b16;color:#f3f4f6;font-family:sans-serif\";\n            const title = document.createElement(\"h1\");\n            title.textContent = \"AI Novel 启动失败\";\n            const detail = document.createElement(\"pre\");\n            detail.style.cssText = \"white-space:pre-wrap;word-break:break-word;margin-top:16px;padding:12px;background:#020617;border-radius:10px;font-size:12px\";\n            detail.textContent = reason instanceof Error ? (reason.stack || reason.message) : String(reason || \"Unknown startup error\");\n            box.append(title, detail);\n            root.append(box);\n          }, 0);\n        };\n        window.addEventListener(\"error\", (event) => reportFatal(event.error || event.message));\n        window.addEventListener(\"unhandledrejection\", (event) => reportFatal(event.reason));\n      })();\n    </script>\n    <!-- AI-NOVEL-APP local-first mobile runtime: end -->`;
if (!html.includes("AI-NOVEL-APP local-first mobile runtime: start")) {
  html = html.replace(
    "    <title>AI 小说创作工作台 | AI Novel Production Engine</title>",
    `    <title>AI 小说创作工作台 | AI Novel Production Engine</title>${marker}`,
  );
}
html = html.replace(
  "系统会在界面和本地创作服务准备好后自动进入。",
  "系统会加载本地创作数据，并在需要 AI 时直接连接 DeepSeek。",
);
write("client/index.html", html);

// Extend the global runtime declaration without changing desktop/web behavior.
let viteEnv = read("client/src/vite-env.d.ts");
if (!viteEnv.includes("localFirst?: boolean;")) {
  viteEnv = viteEnv.replace("    apiBaseUrl?: string;", "    apiBaseUrl?: string;\n    localFirst?: boolean;");
  write("client/src/vite-env.d.ts", viteEnv);
}

// Mobile wrapper no longer needs LAN cleartext/server compatibility flags.
// Native CapacitorHttp patches fetch/XHR so packaged Android requests bypass WebView CORS.
let cap = read("mobile/capacitor.config.ts");
cap = cap.replace(/,?\n\s*server:\s*\{[\s\S]*?\n\s*\},?\n\s*android:\s*\{[\s\S]*?\n\s*\}/m, "");
if (!cap.includes("CapacitorHttp")) {
  cap = cap.replace(
    /webDir:\s*([^,\n]+),?/,
    `webDir: $1,\n  plugins: {\n    CapacitorHttp: {\n      enabled: true,\n    },\n  }`,
  );
}
write("mobile/capacitor.config.ts", cap);

write("mobile/README.md", `# AI-NOVEL-APP Android\n\nAndroid is now a local-first build of the upstream AI Novel Production Engine UI. It does not ask for or connect to an AI-NOVEL server address.\n\n## Runtime\n\n- UI: upstream React client, preserved as the primary product surface.\n- Local data: stored in the app WebView IndexedDB.\n- AI: direct DeepSeek API calls from the packaged app through Capacitor native HTTP.\n- Provider scope: DeepSeek only on Android.\n- Models: deepseek-v4-pro and deepseek-v4-flash.\n- Configuration: enter the DeepSeek API Key in the mobile DeepSeek control/settings.\n- Creation Studio: idea interpretation, direction regeneration, confirmation, project creation and short-story draft state are persisted locally.\n- Startup: packaged builds use hash routing and a visible fatal-error fallback instead of a silent white screen.\n\nThe upstream server source remains vendored for desktop/upstream parity, but the Android runtime does not depend on that server.\n\n## License\n\nModified upstream code remains AGPL-3.0-only. See LICENSE and PORTING.md.\n`);

let porting = read("PORTING.md");
porting = porting.replace(/- Strategy:.*$/m, "- Strategy: preserve the upstream product UI and API surface while replacing Android's remote server dependency with an in-app local compatibility runtime plus direct DeepSeek API execution.");
porting = porting.replace(/## Mobile-specific differences[\s\S]*?(?=\n## License and attribution)/m, `## Mobile-specific differences\n\nAndroid is local-first: no server address is requested and the app does not require the upstream Express service at runtime. CRUD/project state, core novel workflow state, and Creation Studio task state are persisted locally; AI-oriented API calls are handled by the DeepSeek-only mobile adapter over Capacitor native HTTP. Packaged routing uses HashRouter and startup failures are surfaced visibly instead of producing a silent white screen. The desktop/server source is still retained in the repository for upstream parity and non-Android builds. Electron-only capabilities remain desktop-only.\n`);
write("PORTING.md", porting);

console.log("Applied local-first Android runtime: no AI Novel server URL; DeepSeek direct only.");
