import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import { get, set } from "idb-keyval";

const DB_KEY = "ai-novel.mobile.local-db.v1";
const DEEPSEEK_KEY = "ai-novel.mobile.deepseek.api-key";
const DEEPSEEK_MODEL = "ai-novel.mobile.deepseek.model";
const DEFAULT_MODEL = "deepseek-v4-pro";
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

interface LocalDb {
  version: 1;
  collections: Record<string, Array<Record<string, any>>>;
  nested: Record<string, Array<Record<string, any>>>;
  misc: Record<string, any>;
}

const emptyDb = (): LocalDb => ({ version: 1, collections: {}, nested: {}, misc: {} });

async function loadDb(): Promise<LocalDb> {
  return (await get<LocalDb>(DB_KEY)) ?? emptyDb();
}

async function saveDb(db: LocalDb) {
  await set(DB_KEY, db);
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix = "local") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function parseBody(raw: unknown) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function normalizePath(config: AxiosRequestConfig) {
  const raw = String(config.url || "");
  try {
    const base = config.baseURL || "local://api";
    const url = new URL(raw, base.endsWith("/") ? base : `${base}/`);
    let path = url.pathname.replace(/^\/api\/?/, "/");
    if (!path.startsWith("/")) path = `/${path}`;
    return path.replace(/\/$/, "") || "/";
  } catch {
    let path = raw.split("?")[0].replace(/^https?:\/\/[^/]+/i, "").replace(/^\/api\/?/, "/");
    if (!path.startsWith("/")) path = `/${path}`;
    return path.replace(/\/$/, "") || "/";
  }
}

function ok<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<any> {
  return {
    data: { success: true, data },
    status,
    statusText: status === 201 ? "Created" : "OK",
    headers: {},
    config: config as any,
  };
}

function raw<T>(config: AxiosRequestConfig, data: T, status = 200, headers: Record<string, string> = {}): AxiosResponse<any> {
  return { data, status, statusText: "OK", headers, config: config as any };
}

function fail(config: AxiosRequestConfig, status: number, error: string, message?: string): never {
  const e: any = new Error(message || error);
  e.config = config;
  e.response = {
    data: { success: false, error, message },
    status,
    statusText: error,
    headers: {},
    config,
  };
  throw e;
}

function collection(db: LocalDb, name: string) {
  return (db.collections[name] ??= []);
}

function nestedCollection(db: LocalDb, key: string) {
  return (db.nested[key] ??= []);
}

function withTimestamps<T extends Record<string, any>>(value: T, existing?: Record<string, any>) {
  const timestamp = now();
  return {
    ...existing,
    ...value,
    createdAt: existing?.createdAt ?? value.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function getDeepSeekKey() {
  return localStorage.getItem(DEEPSEEK_KEY)?.trim() || "";
}

export function setDeepSeekApiKey(value: string) {
  const key = value.trim();
  if (key) localStorage.setItem(DEEPSEEK_KEY, key);
  else localStorage.removeItem(DEEPSEEK_KEY);
}

export function getDeepSeekApiKeyStatus() {
  return Boolean(getDeepSeekKey());
}

export function setDeepSeekModel(model: string) {
  localStorage.setItem(DEEPSEEK_MODEL, model.trim() || DEFAULT_MODEL);
}

export function getDeepSeekModel() {
  return localStorage.getItem(DEEPSEEK_MODEL)?.trim() || DEFAULT_MODEL;
}

async function deepSeekJson(path: string, method: string, payload: unknown, context?: unknown) {
  const apiKey = getDeepSeekKey();
  if (!apiKey) {
    const e: any = new Error("请先在右下角 DeepSeek 设置中填写 API Key。");
    e.status = 401;
    throw e;
  }

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getDeepSeekModel(),
      thinking: { type: "enabled", reasoning_effort: "high" },
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 AI Novel Production Engine 的本地工作流执行器。",
            "当前 Android 版本没有远程业务服务器，必须直接完成原接口对应的小说生产任务。",
            "只输出合法 JSON，不要 Markdown。",
            "返回值必须是该接口 data 字段本身，不要额外包 success/data。",
            "尽量保留原业务语义：世界观、人物、卷章、大纲、审校、改写、续写、分析、导演工作流等。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({ endpoint: path, method, payload, localContext: context ?? null }),
        },
      ],
      max_tokens: 32768,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const e: any = new Error(`DeepSeek 请求失败 (${response.status}) ${detail.slice(0, 300)}`);
    e.status = response.status;
    throw e;
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek 未返回可用内容。");
  }
  try {
    return JSON.parse(content);
  } catch {
    return { content };
  }
}

function isAiAction(path: string, method: string) {
  if (method === "get") {
    return /(analysis|overview|visualization|recommend|timeline|workspace|trace|status|catalog)/i.test(path);
  }
  return /(generate|recommend|analy|rewrite|revision|review|check|suggest|optimi|director|produce|production|chat|run|extract|backfill|repair|complete|draft|plan|outline|inspiration|skeleton|consistency|platform|execution-contract|style)/i.test(path);
}

function localContext(db: LocalDb) {
  return {
    novels: db.collections.novels ?? [],
    worlds: db.collections.worlds ?? [],
    characters: db.collections.characters ?? [],
    knowledge: db.collections.knowledge ?? [],
  };
}

function novelListShape(items: Array<Record<string, any>>, params: any) {
  const page = Math.max(1, Number(params?.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(params?.limit) || 20));
  const search = String(params?.search || "").trim().toLowerCase();
  let filtered = items;
  if (search) filtered = filtered.filter((item) => `${item.title || ""} ${item.description || ""}`.toLowerCase().includes(search));
  if (params?.status) filtered = filtered.filter((item) => item.status === params.status);
  const total = filtered.length;
  const pageItems = filtered.slice((page - 1) * limit, page * limit).map((item) => ({
    ...item,
    _count: item._count ?? { chapters: 0, characters: 0, plotBeats: 0 },
  }));
  return { items: pageItems, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function handleNovelRoute(config: AxiosRequestConfig, db: LocalDb, path: string, method: string, body: any) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "novels") return null;
  const novels = collection(db, "novels");

  if (parts.length === 1) {
    if (method === "get") return ok(config, novelListShape(novels, config.params));
    if (method === "post") {
      const item = withTimestamps({ id: makeId("novel"), status: "draft", creationExperience: "professional", ...body });
      novels.unshift(item);
      await saveDb(db);
      return ok(config, item, 201);
    }
  }

  if (parts.length >= 2 && parts[1] === "resource-recommendation") {
    const data = await deepSeekJson(path, method, body, localContext(db));
    return ok(config, data);
  }

  const novelId = parts[1];
  const index = novels.findIndex((item) => item.id === novelId);
  if (index < 0 && parts.length <= 2) fail(config, 404, "作品不存在");
  const novel = index >= 0 ? novels[index] : undefined;

  if (parts.length === 2) {
    if (method === "get") {
      const chapters = nestedCollection(db, `novels:${novelId}:chapters`).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      const characters = nestedCollection(db, `novels:${novelId}:characters`);
      return ok(config, { ...novel, chapters, characters, bible: novel?.bible ?? null, plotBeats: novel?.plotBeats ?? [] });
    }
    if (method === "put" || method === "patch") {
      novels[index] = withTimestamps(body, novel);
      await saveDb(db);
      return ok(config, novels[index]);
    }
    if (method === "delete") {
      novels.splice(index, 1);
      Object.keys(db.nested).filter((key) => key.startsWith(`novels:${novelId}:`)).forEach((key) => delete db.nested[key]);
      await saveDb(db);
      return ok(config, null);
    }
  }

  if (parts[2] === "chapters") {
    const chapters = nestedCollection(db, `novels:${novelId}:chapters`);
    if (parts.length === 3) {
      if (method === "get") return ok(config, chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)));
      if (method === "post") {
        const chapter = withTimestamps({ id: makeId("chapter"), novelId, chapterStatus: "draft", ...body });
        chapters.push(chapter);
        if (novel) novel._count = { ...(novel._count || {}), chapters: chapters.length };
        await saveDb(db);
        return ok(config, chapter, 201);
      }
    }
    const chapterId = parts[3];
    const chapterIndex = chapters.findIndex((item) => item.id === chapterId);
    if (chapterIndex >= 0 && parts.length === 4) {
      if (method === "put" || method === "patch") {
        chapters[chapterIndex] = withTimestamps(body, chapters[chapterIndex]);
        await saveDb(db);
        return ok(config, chapters[chapterIndex]);
      }
      if (method === "delete") {
        chapters.splice(chapterIndex, 1);
        await saveDb(db);
        return ok(config, null);
      }
    }
    if (isAiAction(path, method)) {
      const data = await deepSeekJson(path, method, body, { novel, chapter: chapterIndex >= 0 ? chapters[chapterIndex] : null, chapters });
      return ok(config, data);
    }
  }

  if (isAiAction(path, method)) {
    const data = await deepSeekJson(path, method, body, { novel, ...localContext(db) });
    return ok(config, data);
  }
  return null;
}

async function handleWorldRoute(config: AxiosRequestConfig, db: LocalDb, path: string, method: string, body: any) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "worlds") return null;
  const worlds = collection(db, "worlds");

  if (parts.length === 1) {
    if (method === "get") return ok(config, worlds);
    if (method === "post") {
      const item = withTimestamps({ id: makeId("world"), ...body });
      worlds.unshift(item);
      await saveDb(db);
      return ok(config, item, 201);
    }
  }
  if (["templates", "library", "import", "inspiration", "skeleton"].includes(parts[1])) {
    if ((parts[1] === "library" || parts[1] === "templates") && method === "get") {
      return ok(config, collection(db, parts[1] === "library" ? "world-library" : "world-templates"));
    }
    const data = await deepSeekJson(path, method, body, localContext(db));
    return ok(config, data);
  }

  const worldId = parts[1];
  const index = worlds.findIndex((item) => item.id === worldId);
  if (index < 0) fail(config, 404, "世界观不存在");
  const world = worlds[index];
  if (parts.length === 2) {
    if (method === "get") return ok(config, world);
    if (method === "put" || method === "patch") {
      worlds[index] = withTimestamps(body, world);
      await saveDb(db);
      return ok(config, worlds[index]);
    }
    if (method === "delete") {
      worlds.splice(index, 1);
      await saveDb(db);
      return ok(config, null);
    }
  }

  if (parts[2] === "snapshots") {
    const snapshots = nestedCollection(db, `worlds:${worldId}:snapshots`);
    if (parts.length === 3 && method === "get") return ok(config, snapshots);
    if (parts.length === 3 && method === "post") {
      const snapshot = { id: makeId("snapshot"), worldId, label: body?.label || `快照 ${snapshots.length + 1}`, data: structuredClone(world), createdAt: now() };
      snapshots.unshift(snapshot);
      await saveDb(db);
      return ok(config, snapshot, 201);
    }
    if (parts[4] === "restore" && method === "post") {
      const snapshot = snapshots.find((item) => item.id === parts[3]);
      if (!snapshot) fail(config, 404, "快照不存在");
      worlds[index] = withTimestamps({ ...(snapshot.data || {}), id: worldId }, world);
      await saveDb(db);
      return ok(config, worlds[index]);
    }
  }

  if (parts[2] === "structure" && method === "get") {
    return ok(config, { worldId, hasStructuredData: Boolean(world.structure), structure: world.structure ?? {}, bindingSupport: world.bindingSupport ?? {} });
  }
  if (parts[2] === "structure" && parts.length === 3 && (method === "put" || method === "patch")) {
    worlds[index] = withTimestamps({ ...world, structure: body.structure ?? {}, bindingSupport: body.bindingSupport ?? world.bindingSupport ?? {} }, world);
    await saveDb(db);
    return ok(config, { world: worlds[index], structure: worlds[index].structure, bindingSupport: worlds[index].bindingSupport });
  }

  if (isAiAction(path, method) || method === "post") {
    const data = await deepSeekJson(path, method, body, { world, ...localContext(db) });
    return ok(config, data);
  }
  return null;
}

async function handleGenericCrud(config: AxiosRequestConfig, db: LocalDb, path: string, method: string, body: any) {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return ok(config, { runtime: "mobile-local", provider: "deepseek" });
  const name = parts[0];
  const items = collection(db, name);

  if (parts.length === 1) {
    if (method === "get") return ok(config, items);
    if (method === "post" && !isAiAction(path, method)) {
      const item = withTimestamps({ id: makeId(name.replace(/s$/, "")), ...body });
      items.unshift(item);
      await saveDb(db);
      return ok(config, item, 201);
    }
  }

  if (parts.length === 2 && !isAiAction(path, method)) {
    const id = parts[1];
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0 && method === "get") return ok(config, items[index]);
    if (index >= 0 && (method === "put" || method === "patch")) {
      items[index] = withTimestamps(body, items[index]);
      await saveDb(db);
      return ok(config, items[index]);
    }
    if (index >= 0 && method === "delete") {
      items.splice(index, 1);
      await saveDb(db);
      return ok(config, null);
    }
  }

  if (isAiAction(path, method) || method === "post") {
    const data = await deepSeekJson(path, method, body, localContext(db));
    return ok(config, data);
  }

  return ok(config, []);
}

export const localApiAdapter: AxiosAdapter = async (config: any) => {
  const path = normalizePath(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);

  if (path === "/health" || path === "/healthz") {
    return ok(config, { status: "ok", runtime: "mobile-local", provider: "deepseek" });
  }
  if (path === "/mobile/deepseek/status") {
    return ok(config, { configured: getDeepSeekApiKeyStatus(), model: getDeepSeekModel() });
  }
  if (path === "/mobile/deepseek/config" && (method === "post" || method === "put")) {
    setDeepSeekApiKey(String(body?.apiKey || ""));
    if (body?.model) setDeepSeekModel(String(body.model));
    return ok(config, { configured: getDeepSeekApiKeyStatus(), model: getDeepSeekModel() });
  }

  const db = await loadDb();
  const novel = await handleNovelRoute(config, db, path, method, body);
  if (novel) return novel;
  const world = await handleWorldRoute(config, db, path, method, body);
  if (world) return world;
  return handleGenericCrud(config, db, path, method, body);
};

export function installDeepSeekQuickSettings() {
  if (typeof window === "undefined" || document.getElementById("ai-novel-deepseek-settings")) return;
  const button = document.createElement("button");
  button.id = "ai-novel-deepseek-settings";
  button.type = "button";
  button.textContent = getDeepSeekApiKeyStatus() ? "DeepSeek ✓" : "设置 DeepSeek";
  button.setAttribute("aria-label", "配置 DeepSeek API Key");
  Object.assign(button.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: "2147483647",
    border: "1px solid rgba(87,215,208,.45)",
    borderRadius: "999px",
    padding: "9px 13px",
    background: "rgba(9,11,22,.92)",
    color: "#fff",
    fontSize: "12px",
    lineHeight: "1",
    boxShadow: "0 4px 18px rgba(0,0,0,.28)",
  });
  button.addEventListener("click", () => {
    const current = getDeepSeekKey();
    const entered = window.prompt("DeepSeek API Key（仅保存在本机）", current ? "" : "");
    if (entered === null) return;
    const value = entered.trim();
    if (value) setDeepSeekApiKey(value);
    else if (!current) return;
    button.textContent = getDeepSeekApiKeyStatus() ? "DeepSeek ✓" : "设置 DeepSeek";
  });
  document.body.appendChild(button);
}
