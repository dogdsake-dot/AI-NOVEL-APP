import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "highlight.js/styles/github.css";
import DesktopBootstrapBoundary from "./components/layout/DesktopBootstrapBoundary";
import ServerStartupGate from "./components/layout/ServerStartupGate";
import { APP_RUNTIME, APP_RUNTIME_IS_PACKAGED } from "./lib/constants";
import AppRouter from "./router";
import { Toaster } from "./components/ui/toast";
import "./index.css";
import { ThemeProvider } from "./components/theme/ThemeProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function formatStartupError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function StartupFailure({ error }: { error: unknown }) {
  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#090b16", color: "#f3f4f6", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "48px auto", padding: 20, border: "1px solid #334155", borderRadius: 16, background: "#111827" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>AI Novel 启动失败</h1>
        <p style={{ lineHeight: 1.7, color: "#cbd5e1" }}>
          Android 本地运行时发生异常。此页面用于替代无信息白屏，方便定位问题。
        </p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", padding: 12, borderRadius: 10, background: "#020617", color: "#e2e8f0", fontSize: 12 }}>
          {formatStartupError(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: "10px 16px", border: 0, borderRadius: 10, background: "#57d7d0", color: "#07111a", fontWeight: 700 }}
        >
          重新加载
        </button>
      </div>
    </main>
  );
}

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[AI-NOVEL-APP] React startup error", error, info.componentStack);
  }

  render() {
    if (this.state.error) return <StartupFailure error={this.state.error} />;
    return this.props.children;
  }
}

function installBlankScreenGuard() {
  const renderFallback = (error: unknown) => {
    window.setTimeout(() => {
      const root = document.getElementById("root");
      if (!root || root.textContent?.trim()) return;
      root.replaceChildren();
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "min-height:100vh;padding:24px;background:#090b16;color:#f3f4f6;font-family:sans-serif";
      const title = document.createElement("h1");
      title.textContent = "AI Novel 启动失败";
      const detail = document.createElement("pre");
      detail.style.cssText = "white-space:pre-wrap;word-break:break-word;margin-top:16px;padding:12px;background:#020617;border-radius:10px;font-size:12px";
      detail.textContent = formatStartupError(error);
      wrapper.append(title, detail);
      root.append(wrapper);
    }, 0);
  };

  window.addEventListener("error", (event) => renderFallback(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => renderFallback(event.reason));
}

installBlankScreenGuard();

// Capacitor serves the packaged app from a synthetic localhost origin. Hash routing avoids
// native WebView history/path edge cases while leaving normal web builds on BrowserRouter.
const AppRouterProvider = APP_RUNTIME === "desktop" || APP_RUNTIME_IS_PACKAGED ? HashRouter : BrowserRouter;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element.");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AppRouterProvider>
            <DesktopBootstrapBoundary>
              <ServerStartupGate>
                <AppRouter />
              </ServerStartupGate>
            </DesktopBootstrapBoundary>
            <Toaster />
          </AppRouterProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </StartupErrorBoundary>
  </React.StrictMode>,
);
