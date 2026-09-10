import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import {
  getDeepSeekApiKeyStatus,
  getDeepSeekModel,
  localApiAdapter,
  setDeepSeekApiKey,
  setDeepSeekModel,
} from "./localRuntime";

const DEEPSEEK_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function parseBody(raw: unknown) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as Record<string, any>;
}

function pathOf(config: AxiosRequestConfig) {
  const raw = String(config.url || "");
  try {
    const url = new URL(raw, "local://api/");
    return url.pathname.replace(/^\/api\/?/, "/").replace(/\/$/, "") || "/";
  } catch {
    return raw.split("?")[0].replace(/^\/api\/?/, "/").replace(/\/$/, "") || "/";
  }
}

function ok<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<any> {
  return { data: { success: true, data }, status, statusText: "OK", headers: {}, config: config as any };
}

function providerStatus() {
  const configured = getDeepSeekApiKeyStatus();
  const model = getDeepSeekModel();
  return {
    provider: "deepseek",
    kind: "builtin",
    name: "DeepSeek",
    displayName: "DeepSeek",
    currentModel: model,
    currentImageModel: null,
    currentBaseURL: DEEPSEEK_BASE_URL,
    currentAuthMode: "bearer",
    models: DEEPSEEK_MODELS,
    imageModels: [],
    defaultModel: "deepseek-v4-pro",
    defaultImageModel: null,
    defaultBaseURL: DEEPSEEK_BASE_URL,
    requiresApiKey: true,
    isConfigured: configured,
    isActive: true,
    reasoningEnabled: true,
    reasoningEffort: "high",
    supportsReasoningEffort: true,
    hiddenModels: [],
    concurrencyLimit: 0,
    requestIntervalMs: 0,
    supportsImageGeneration: false,
  };
}

async function probeDeepSeek(apiKey: string, model: string) {
  const started = performance.now();
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "Reply with OK." }],
      max_tokens: 8,
    }),
  });
  const latency = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return latency;
}

export const mobileApiAdapter: AxiosAdapter = async (config: any) => {
  const path = pathOf(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);

  if (path === "/settings/api-keys" && method === "get") {
    return ok(config, [providerStatus()]);
  }
  if (path === "/settings/api-keys/balances" && method === "get") {
    return ok(config, [{
      provider: "deepseek",
      status: getDeepSeekApiKeyStatus() ? "unsupported" : "missing_api_key",
      supported: false,
      canRefresh: false,
      source: "none",
      currency: null,
      availableBalance: null,
      totalBalance: null,
      cashBalance: null,
      voucherBalance: null,
      chargeBalance: null,
      toppedUpBalance: null,
      grantedBalance: null,
      fetchedAt: new Date().toISOString(),
      message: "移动本地版不通过业务服务器查询余额。",
      error: null,
    }]);
  }
  if (path === "/settings/api-keys/deepseek" && (method === "put" || method === "patch")) {
    if (typeof body.key === "string" && body.key.trim()) setDeepSeekApiKey(body.key);
    if (typeof body.model === "string" && body.model.trim()) setDeepSeekModel(body.model);
    return ok(config, providerStatus());
  }
  if (path === "/settings/api-keys/deepseek/refresh-models" && method === "post") {
    return ok(config, { provider: "deepseek", models: DEEPSEEK_MODELS, currentModel: getDeepSeekModel() });
  }
  if (path === "/llm/providers" && method === "get") {
    return ok(config, { deepseek: providerStatus() });
  }
  if (path === "/settings/llm-selection" && method === "get") {
    return ok(config, { provider: "deepseek", model: getDeepSeekModel(), temperature: 0.7, maxTokens: 32768 });
  }
  if (path === "/settings/llm-selection" && method === "put") {
    if (typeof body.model === "string") setDeepSeekModel(body.model);
    return ok(config, { provider: "deepseek", model: getDeepSeekModel(), temperature: Number(body.temperature ?? 0.7), maxTokens: body.maxTokens ?? 32768 });
  }
  if (path === "/llm/structured-fallback" && method === "get") {
    return ok(config, { enabled: true, provider: "deepseek", model: getDeepSeekModel(), temperature: 0.2, maxTokens: 32768 });
  }
  if (path === "/llm/structured-fallback" && method === "put") {
    if (typeof body.model === "string") setDeepSeekModel(body.model);
    return ok(config, { enabled: body.enabled ?? true, provider: "deepseek", model: getDeepSeekModel(), temperature: body.temperature ?? 0.2, maxTokens: body.maxTokens ?? 32768 });
  }
  if (path === "/llm/model-routes" && method === "get") {
    return ok(config, { taskTypes: [], routes: [] });
  }
  if (path === "/llm/model-routes" && method === "put") {
    return ok(config, null);
  }
  if (path === "/llm/model-routes/connectivity" && method === "post") {
    return ok(config, { testedAt: new Date().toISOString(), statuses: [] });
  }
  if (path === "/llm/test" && method === "post") {
    const key = String(body.apiKey || localStorage.getItem("ai-novel.mobile.deepseek.api-key") || "").trim();
    const model = String(body.model || getDeepSeekModel());
    if (!key) throw new Error("请填写 DeepSeek API Key。");
    const latency = await probeDeepSeek(key, model);
    if (body.apiKey) setDeepSeekApiKey(key);
    if (body.model) setDeepSeekModel(model);
    return ok(config, {
      success: true,
      model,
      latency,
      plain: { ok: true, latency, error: null },
      structured: {
        ok: true,
        latency,
        error: null,
        strategy: "json_object",
        reasoningForcedOff: true,
        fallbackAvailable: false,
        fallbackUsed: false,
        errorCategory: null,
        nativeJsonObject: true,
        nativeJsonSchema: false,
        profileFamily: "deepseek-v4",
      },
    });
  }

  return localApiAdapter(config);
};
