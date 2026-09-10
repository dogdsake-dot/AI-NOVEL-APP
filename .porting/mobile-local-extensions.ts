import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import { get, set } from "idb-keyval";
import { mobileApiAdapter } from "./apiAdapter";

const DB_KEY = "ai-novel.mobile.local-db.v1";

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

function parseBody(raw: unknown): Record<string, any> {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as Record<string, any>;
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

function fail(config: AxiosRequestConfig, status: number, error: string): never {
  const e: any = new Error(error);
  e.config = config;
  e.response = { data: { success: false, error }, status, statusText: error, headers: {}, config };
  throw e;
}

function collection(db: LocalDb, name: string) {
  return (db.collections[name] ??= []);
}

function nested(db: LocalDb, key: string) {
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

function findNovel(db: LocalDb, novelId: string) {
  const novels = collection(db, "novels");
  const index = novels.findIndex((item) => item.id === novelId);
  return { novels, index, novel: index >= 0 ? novels[index] : undefined };
}

function mapShelfChapterStatus(chapter: Record<string, any>) {
  const status = chapter.chapterStatus || chapter.status;
  if (status === "completed") return "completed";
  if (status === "generating") return "generating";
  if (status === "pending_review") return "reviewing";
  if (status === "needs_repair") return "quality_debt";
  if (status === "pending_generation") return "waiting_writing";
  return "waiting_planning";
}

function wordCount(content: unknown) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return 0;
  const han = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words = text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  return han + words;
}

function fileSafeName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "novel";
}

function serializeNovel(novel: Record<string, any>, chapters: Array<Record<string, any>>, characters: Array<Record<string, any>>, format: string) {
  const ordered = chapters.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  if (format === "json") return JSON.stringify({ novel, characters, chapters: ordered }, null, 2);
  if (format === "markdown") {
    return [
      `# ${novel.title || "未命名作品"}`, "", novel.description || "", "", "## 角色", "",
      ...characters.flatMap((c) => [`### ${c.name || "未命名角色"}`, "", [c.role, c.personality, c.background].filter(Boolean).join(" · "), ""]),
      "## 正文", "",
      ...ordered.flatMap((c) => [`### 第${c.order ?? ""}章 ${c.title || ""}`.trim(), "", c.content || "", ""]),
    ].join("\n");
  }
  return [
    novel.title || "未命名作品", novel.description || "", "",
    ...ordered.flatMap((c) => [`第${c.order ?? ""}章 ${c.title || ""}`.trim(), c.content || "", ""]),
  ].join("\n");
}

async function handleNovelCompatibility(config: AxiosRequestConfig, db: LocalDb, path: string, method: string, body: Record<string, any>): Promise<AxiosResponse<any> | null> {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "novels" || !parts[1] || parts[1] === "resource-recommendation") return null;

  const novelId = parts[1];
  const { novels, index, novel } = findNovel(db, novelId);
  if (!novel) return null;

  if (parts[2] === "creation-experience" && parts[3] && method === "post") {
    novels[index] = withTimestamps({ creationExperience: parts[3] }, novel);
    await saveDb(db);
    return ok(config, novels[index]);
  }

  if (parts[2] === "writing-platform" && parts.length === 3 && method === "put") {
    novels[index] = withTimestamps({ writingPlatform: body.platform ?? null }, novel);
    await saveDb(db);
    return ok(config, novels[index]);
  }

  if (parts[2] === "simple-shelf" && method === "get") {
    const chapters = nested(db, `novels:${novelId}:chapters`).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const characters = nested(db, `novels:${novelId}:characters`);
    const volumes = nested(db, `novels:${novelId}:volumes`);
    const worlds = collection(db, "worlds");
    const world = novel.worldId ? worlds.find((item) => item.id === novel.worldId) : undefined;
    const completed = chapters.filter((chapter) => (chapter.chapterStatus || chapter.status) === "completed").length;
    const total = Math.max(chapters.length, Number(novel.estimatedChapterCount || 0));
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    return ok(config, {
      novel: { id: novel.id, title: novel.title || "未命名作品", creationExperience: novel.creationExperience || "simple", estimatedChapterCount: novel.estimatedChapterCount ?? null },
      progress: {
        directorTaskId: null,
        percent,
        completedChapters: completed,
        totalChapters: total,
        currentAction: total > 0 && completed >= total ? "创作已完成" : "继续创作",
        status: total > 0 && completed >= total ? "completed" : "paused",
        canRetry: false,
        safetyMessage: null,
        riskHistory: [],
      },
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        order: Number(chapter.order || 0),
        title: chapter.title || "",
        status: mapShelfChapterStatus(chapter),
        wordCount: wordCount(chapter.content),
        content: chapter.content ?? null,
        updatedAt: chapter.updatedAt || now(),
        qualityDebt: null,
      })),
      materials: {
        description: novel.description ?? null,
        characterCount: characters.length,
        volumeCount: volumes.length,
        openQualityDebtCount: chapters.filter((chapter) => (chapter.chapterStatus || chapter.status) === "needs_repair").length,
        story: {
          coreSellingPoint: novel.bookSellingPoint ?? null,
          readingPromise: novel.readingPromise ?? null,
          first30ChapterPromise: novel.first30ChapterPromise ?? null,
          protagonistFantasy: novel.protagonistFantasy ?? null,
        },
        world: world ? { name: world.name || "未命名世界", summary: world.description ?? world.summary ?? null } : null,
        characters: characters.map((character) => ({ id: character.id, name: character.name || "未命名角色", role: character.role || "", storyFunction: character.storyFunction ?? null, currentGoal: character.currentGoal ?? null, personality: character.personality ?? null })),
        volumes: volumes.map((volume) => ({ id: volume.id, order: Number(volume.order || 0), title: volume.title || "", summary: volume.summary ?? null, mainPromise: volume.mainPromise ?? null, chapterCount: Number(volume.chapterCount || 0) })),
      },
    });
  }

  if (parts[2] === "export" && parts.length === 3 && method === "get") {
    const format = String((config.params as any)?.format || "txt").toLowerCase();
    const chapters = nested(db, `novels:${novelId}:chapters`);
    const characters = nested(db, `novels:${novelId}:characters`);
    const content = serializeNovel(novel, chapters, characters, format);
    const mime = format === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
    const extension = format === "markdown" ? "md" : format === "json" ? "json" : "txt";
    const blob = new Blob([content], { type: mime });
    const fileName = `${fileSafeName(novel.title || novel.id)}.${extension}`;
    return raw(config, blob, 200, { "content-type": mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` });
  }

  if (parts[2] === "export-as-document" && parts.length === 3 && method === "post") {
    const chapters = nested(db, `novels:${novelId}:chapters`);
    const characters = nested(db, `novels:${novelId}:characters`);
    const content = serializeNovel(novel, chapters, characters, "markdown");
    const timestamp = now();
    const documentId = makeId("knowledge");
    const versionId = makeId("knowledge_version");
    const version = { id: versionId, documentId, versionNumber: 1, content, contentHash: `local-${content.length}-${Date.now()}`, charCount: content.length, createdAt: timestamp, isActive: true };
    const document = {
      id: documentId,
      title: novel.title || "未命名作品",
      fileName: `${fileSafeName(novel.title || novel.id)}.md`,
      kind: "analysis_published",
      sourceAnalysisId: null,
      status: "enabled",
      activeVersionId: versionId,
      activeVersionNumber: 1,
      latestIndexStatus: "idle",
      latestIndexError: null,
      lastIndexedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      bookAnalysisCount: 0,
      versions: [version],
    };
    collection(db, "knowledge").unshift(document);
    await saveDb(db);
    return ok(config, document, 201);
  }

  if (parts[2] === "characters") {
    const characters = nested(db, `novels:${novelId}:characters`);
    if (parts.length === 3) {
      if (method === "get") return ok(config, characters);
      if (method === "post") {
        const character = withTimestamps({ id: makeId("character"), novelId, role: "", gender: "unknown", ...body });
        characters.push(character);
        novels[index]._count = { ...(novels[index]._count || {}), characters: characters.length };
        await saveDb(db);
        return ok(config, character, 201);
      }
    }

    if (parts.length >= 4) {
      const characterId = parts[3];
      const characterIndex = characters.findIndex((item) => item.id === characterId);
      const character = characterIndex >= 0 ? characters[characterIndex] : undefined;

      if (parts.length === 4) {
        if (method === "get") {
          if (!character) fail(config, 404, "角色不存在");
          return ok(config, character);
        }
        if (method === "put" || method === "patch") {
          if (!character) fail(config, 404, "角色不存在");
          characters[characterIndex] = withTimestamps(body, character);
          await saveDb(db);
          return ok(config, characters[characterIndex]);
        }
        if (method === "delete") {
          if (!character) fail(config, 404, "角色不存在");
          characters.splice(characterIndex, 1);
          novels[index]._count = { ...(novels[index]._count || {}), characters: characters.length };
          await saveDb(db);
          return ok(config, null);
        }
      }

      if (parts[4] === "timeline" && parts.length === 5 && method === "get") return ok(config, nested(db, `novels:${novelId}:characters:${characterId}:timeline`));
      if (parts[4] === "timeline" && parts[5] === "sync" && method === "post") {
        const timeline = nested(db, `novels:${novelId}:characters:${characterId}:timeline`);
        return ok(config, { characterId, syncedCount: 0, totalTimelineCount: timeline.length });
      }
      if (parts[4] === "resources" && method === "get") {
        const items = nested(db, `novels:${novelId}:character-resources`);
        return ok(config, items.filter((item) => item.ownerCharacterId === characterId || item.holderCharacterId === characterId || item.ownerId === characterId));
      }
    }
  }

  if (parts[2] === "characters" && parts[3] === "timeline" && parts[4] === "sync" && method === "post") {
    const characters = nested(db, `novels:${novelId}:characters`);
    const details = characters.map((character) => {
      const timeline = nested(db, `novels:${novelId}:characters:${character.id}:timeline`);
      return { characterId: character.id, syncedCount: 0, totalTimelineCount: timeline.length };
    });
    return ok(config, { characterCount: characters.length, syncedCount: 0, details });
  }

  if (parts[2] === "character-relations" && method === "get") return ok(config, nested(db, `novels:${novelId}:character-relations`));

  if (parts[2] === "character-resources" && parts.length === 3 && method === "get") {
    return ok(config, { items: nested(db, `novels:${novelId}:character-resources`), pendingProposals: nested(db, `novels:${novelId}:character-resource-proposals`) });
  }

  if (parts[2] === "chapters" && parts[3] && parts[4] === "resource-context" && method === "get") {
    return ok(config, {
      summary: "本地资源上下文",
      availableItems: nested(db, `novels:${novelId}:character-resources`),
      setupNeededItems: [],
      blockedItems: [],
      highRiskCommittedItems: [],
      pendingProposalItems: nested(db, `novels:${novelId}:character-resource-proposals`),
      riskSignals: [],
    });
  }

  if (parts[2] === "chapters" && parts[3] && parts[4] === "traces" && method === "get") return ok(config, nested(db, `novels:${novelId}:chapters:${parts[3]}:traces`));

  return null;
}

function snapshotChanges(before: Record<string, any>, after: Record<string, any>) {
  const ignored = new Set(["createdAt", "updatedAt"]);
  return Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]))
    .filter((field) => !ignored.has(field))
    .filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null))
    .map((field) => ({
      field,
      before: before?.[field] == null ? null : typeof before[field] === "string" ? before[field] : JSON.stringify(before[field]),
      after: after?.[field] == null ? null : typeof after[field] === "string" ? after[field] : JSON.stringify(after[field]),
    }));
}

function worldMarkdown(world: Record<string, any>) {
  const lines = [`# ${world.name || "未命名世界"}`, "", world.description || world.summary || "", ""];
  if (Array.isArray(world.axioms) && world.axioms.length) lines.push("## 世界公理", "", ...world.axioms.map((item: string) => `- ${item}`), "");
  if (world.layers && typeof world.layers === "object") {
    lines.push("## 世界图层", "");
    for (const [key, value] of Object.entries(world.layers)) lines.push(`### ${key}`, "", typeof value === "string" ? value : JSON.stringify(value, null, 2), "");
  }
  return lines.join("\n");
}

async function handleWorldCompatibility(config: AxiosRequestConfig, db: LocalDb, path: string, method: string, body: Record<string, any>): Promise<AxiosResponse<any> | null> {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "worlds") return null;

  const worlds = collection(db, "worlds");

  if (parts[1] === "library") {
    const library = collection(db, "world-library");
    if (parts.length === 2 && method === "post") {
      const item = withTimestamps({ id: makeId("world_library"), usageCount: 0, ...body });
      library.unshift(item);
      await saveDb(db);
      return ok(config, item, 201);
    }
    if (parts.length === 4 && parts[3] === "use" && method === "post") {
      const item = library.find((entry) => entry.id === parts[2]);
      if (!item) fail(config, 404, "世界资料库条目不存在");
      item.usageCount = Number(item.usageCount || 0) + 1;
      item.updatedAt = now();
      let injected = false;
      if (body.worldId) {
        const worldIndex = worlds.findIndex((entry) => entry.id === body.worldId);
        if (worldIndex >= 0) {
          const target = worlds[worldIndex];
          if (body.targetCollection === "forces" || body.targetCollection === "locations") {
            const current = Array.isArray(target[body.targetCollection]) ? target[body.targetCollection] : [];
            target[body.targetCollection] = [...current, item];
          } else if (body.targetField) {
            const content = item.description || item.name || "";
            target[body.targetField] = [target[body.targetField], content].filter(Boolean).join("\n\n");
          }
          worlds[worldIndex] = withTimestamps(target, target);
          injected = true;
        }
      }
      await saveDb(db);
      return ok(config, { itemId: item.id, injected, worldId: body.worldId ?? null, targetCollection: body.targetCollection ?? null });
    }
    return null;
  }

  if (parts[1] === "import" && method === "post") {
    if (body.format === "json") {
      try {
        const parsed = JSON.parse(String(body.content || "{}"));
        const source = parsed.world && typeof parsed.world === "object" ? parsed.world : parsed;
        const item = withTimestamps({ ...source, id: makeId("world"), name: body.name || source.name || "导入世界观" });
        worlds.unshift(item);
        await saveDb(db);
        return ok(config, item, 201);
      } catch {
        return null;
      }
    }
    return null;
  }

  const worldId = parts[1];
  if (!worldId || ["templates", "inspiration", "skeleton"].includes(worldId)) return null;
  const index = worlds.findIndex((item) => item.id === worldId);
  if (index < 0) return null;
  const world = worlds[index];

  if (parts[2] === "axioms" && parts.length === 3 && method === "put") {
    worlds[index] = withTimestamps({ axioms: Array.isArray(body.axioms) ? body.axioms : [] }, world);
    await saveDb(db);
    return ok(config, worlds[index]);
  }

  if (parts[2] === "layers" && parts[3] && parts.length === 4 && method === "put") {
    const key = parts[3];
    worlds[index] = withTimestamps({
      layers: { ...(world.layers || {}), [key]: body.content ?? "" },
      layerStates: { ...(world.layerStates || {}), [key]: { key, status: "draft", updatedAt: now() } },
    }, world);
    await saveDb(db);
    return ok(config, worlds[index]);
  }

  if (parts[2] === "layers" && parts[3] && parts[4] === "confirm" && method === "post") {
    const key = parts[3];
    worlds[index] = withTimestamps({ layerStates: { ...(world.layerStates || {}), [key]: { key, status: "confirmed", updatedAt: now() } } }, world);
    await saveDb(db);
    return ok(config, worlds[index]);
  }

  if (parts[2] === "deepening" && parts[3] === "answers" && method === "post") {
    const answers = Array.isArray(body.answers) ? body.answers : [];
    const current = Array.isArray(world.deepeningQA) ? world.deepeningQA : [];
    const answerMap = new Map(answers.map((item: any) => [item.questionId, item.answer]));
    worlds[index] = withTimestamps({ deepeningQA: current.map((item: any) => answerMap.has(item.id) ? { ...item, answer: answerMap.get(item.id), answeredAt: now() } : item) }, world);
    await saveDb(db);
    return ok(config, worlds[index].deepeningQA || []);
  }

  if (parts[2] === "consistency" && parts[3] === "issues" && parts[4] && method === "patch") {
    const issueId = parts[4];
    const issues = Array.isArray(world.consistencyIssues) ? world.consistencyIssues : [];
    worlds[index] = withTimestamps({ consistencyIssues: issues.map((item: any) => item.id === issueId ? { ...item, status: body.status } : item) }, world);
    await saveDb(db);
    return ok(config, worlds[index].consistencyIssues || []);
  }

  if (parts[2] === "snapshots" && parts[3] === "diff" && method === "get") {
    const snapshots = nested(db, `worlds:${worldId}:snapshots`);
    const fromId = String((config.params as any)?.from || "");
    const toId = String((config.params as any)?.to || "");
    const from = snapshots.find((item) => item.id === fromId);
    const to = snapshots.find((item) => item.id === toId);
    if (!from || !to) fail(config, 404, "世界观快照不存在");
    return ok(config, { worldId, fromId, toId, changes: snapshotChanges(from.data || {}, to.data || {}) });
  }

  if (parts[2] === "export" && parts.length === 3 && method === "get") {
    const format = String((config.params as any)?.format || "markdown");
    const content = format === "json" ? JSON.stringify(world, null, 2) : worldMarkdown(world);
    return ok(config, { format: format === "json" ? "json" : "markdown", fileName: `${fileSafeName(world.name || world.id)}.${format === "json" ? "json" : "md"}`, content });
  }

  return null;
}

export const extendedMobileApiAdapter: AxiosAdapter = async (config: any) => {
  const path = normalizePath(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);
  const db = await loadDb();

  const novelResponse = await handleNovelCompatibility(config, db, path, method, body);
  if (novelResponse) return novelResponse;

  const worldResponse = await handleWorldCompatibility(config, db, path, method, body);
  if (worldResponse) return worldResponse;

  return mobileApiAdapter(config);
};
