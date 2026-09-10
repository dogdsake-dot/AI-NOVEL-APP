import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import { get, set } from "idb-keyval";
import { mobileWorkflowApiAdapter } from "./workflowAdapter";

const DB_KEY = "ai-novel.mobile.local-db.v1";
const WRITING_PLATFORMS = new Set([
  "qidian", "tomato", "jjwxc", "qimao", "zhihu", "mdxbook",
  "general_male", "general_female", "short_story", "other",
]);

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

function collection(db: LocalDb, name: string) {
  return (db.collections[name] ??= []);
}

function nested(db: LocalDb, key: string) {
  return (db.nested[key] ??= []);
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
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

function fail(config: AxiosRequestConfig, status: number, error: string): never {
  const e: any = new Error(error);
  e.config = config;
  e.response = {
    data: { success: false, error },
    status,
    statusText: error,
    headers: {},
    config,
  };
  throw e;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function normalizeNarrativeForm(value: unknown, fallback: "short_story" | "long_novel" = "long_novel") {
  return value === "short_story" || value === "long_novel" ? value : fallback;
}

function normalizePlatform(value: unknown, fallback = "qidian") {
  return typeof value === "string" && WRITING_PLATFORMS.has(value) ? value : fallback;
}

function normalizeDirection(raw: any, index: number, interpretation: any) {
  const defaults = index === 0
    ? {
        title: "主线推进",
        summary: interpretation.expandedIdea,
        coreConflict: interpretation.coreConflict,
        whyItWorks: "围绕核心冲突直接推进，保证主线清晰并快速建立阅读期待。",
        protagonistPath: interpretation.protagonistWish,
        endingDirection: "完成主矛盾阶段性兑现，并为后续升级留下空间。",
      }
    : {
        title: "反转强化",
        summary: `在“${interpretation.expandedIdea}”基础上强化误导、反转与代价。`,
        coreConflict: interpretation.coreConflict,
        whyItWorks: "通过认知差和代价升级制造更强的章节钩子与情绪波动。",
        protagonistPath: interpretation.protagonistWish,
        endingDirection: "以一次改变人物选择的反转收束当前阶段。",
      };

  return {
    id: asString(raw?.id, makeId(`direction_${index + 1}`)),
    title: asString(raw?.title, defaults.title),
    summary: asString(raw?.summary, defaults.summary),
    coreConflict: asString(raw?.coreConflict, defaults.coreConflict),
    whyItWorks: asString(raw?.whyItWorks, defaults.whyItWorks),
    protagonistPath: asString(raw?.protagonistPath, defaults.protagonistPath),
    endingDirection: asString(raw?.endingDirection, defaults.endingDirection),
    storyModeHint: asString(raw?.storyModeHint) || null,
    commercialFocus: asString(raw?.commercialFocus) || null,
    shortFormAdjustments: asStringArray(raw?.shortFormAdjustments),
  };
}

function normalizeInterpretation(raw: any, request: Record<string, any>, previous?: any) {
  const source = raw?.interpretation && typeof raw.interpretation === "object" ? raw.interpretation : (raw || {});
  const idea = asString(request.idea, asString(previous?.expandedIdea, "待完善的故事构想"));
  const explicitForm = request.preferredNarrativeForm === "short_story" || request.preferredNarrativeForm === "long_novel"
    ? request.preferredNarrativeForm
    : undefined;
  const fallbackForm = explicitForm ?? normalizeNarrativeForm(previous?.recommendedNarrativeForm, "long_novel");
  const fallbackPlatform = normalizePlatform(request.preferredWritingPlatform, normalizePlatform(previous?.recommendedWritingPlatform, "qidian"));

  const interpretation: any = {
    expandedIdea: asString(source.expandedIdea, asString(previous?.expandedIdea, idea)),
    coreConflict: asString(source.coreConflict, asString(previous?.coreConflict, "主角的核心目标与阻碍发生正面冲突。")),
    protagonistWish: asString(source.protagonistWish, asString(previous?.protagonistWish, "主角希望改变当前处境并获得关键目标。")),
    coreSellingPoint: asString(source.coreSellingPoint, asString(previous?.coreSellingPoint)) || null,
    competingFeel: asString(source.competingFeel, asString(previous?.competingFeel)) || null,
    targetAudience: asString(source.targetAudience, asString(previous?.targetAudience)) || null,
    first30ChapterPromise: asString(source.first30ChapterPromise, asString(previous?.first30ChapterPromise)) || null,
    commercialTags: asStringArray(source.commercialTags).length ? asStringArray(source.commercialTags) : asStringArray(previous?.commercialTags),
    genreName: asString(source.genreName, asString(request.preferredGenreName, asString(previous?.genreName, "综合"))),
    worldType: asString(source.worldType, asString(request.preferredWorldType, asString(previous?.worldType, "原创世界"))),
    toneKeywords: asStringArray(source.toneKeywords).length
      ? asStringArray(source.toneKeywords)
      : (asString(request.preferredTone) ? [asString(request.preferredTone)] : asStringArray(previous?.toneKeywords)),
    storyModeHints: asStringArray(source.storyModeHints).length ? asStringArray(source.storyModeHints) : asStringArray(previous?.storyModeHints),
    recommendedNarrativeForm: normalizeNarrativeForm(source.recommendedNarrativeForm, fallbackForm),
    recommendedWritingPlatform: normalizePlatform(source.recommendedWritingPlatform, fallbackPlatform),
    recommendedWritingMode: source.recommendedWritingMode === "continuation" ? "continuation" : (previous?.recommendedWritingMode === "continuation" ? "continuation" : "original"),
    continuationContext: source.continuationContext ?? previous?.continuationContext ?? null,
    directions: [],
  };

  const rawDirections = Array.isArray(source.directions) ? source.directions.slice(0, 2) : [];
  interpretation.directions = [
    normalizeDirection(rawDirections[0], 0, interpretation),
    normalizeDirection(rawDirections[1], 1, interpretation),
  ];
  return interpretation;
}

function taskList(db: LocalDb) {
  return collection(db, "creation-studio-tasks");
}

function findTask(db: LocalDb, taskId: string) {
  const tasks = taskList(db);
  const index = tasks.findIndex((item) => item.taskId === taskId);
  return { tasks, index, task: index >= 0 ? tasks[index] : undefined };
}

function taskProjection(task: Record<string, any>) {
  return {
    taskId: task.taskId,
    idea: task.idea,
    status: task.status,
    stageLabel: task.stageLabel,
    progress: task.progress,
    currentAction: task.currentAction,
    interpretation: task.interpretation ?? null,
    selectedDirectionId: task.selectedDirectionId ?? null,
    narrativeForm: task.narrativeForm ?? null,
    novelId: task.novelId ?? null,
    productionTaskId: task.productionTaskId ?? null,
    resumeRoute: task.resumeRoute ?? null,
    error: task.error ?? null,
  };
}

async function delegateAi(config: AxiosRequestConfig, url: string, payload: Record<string, any>) {
  return mobileWorkflowApiAdapter({
    ...(config as any),
    url,
    method: "post",
    data: JSON.stringify(payload),
  } as any);
}

function extractAiData(response: any) {
  return response?.data?.data ?? response?.data ?? null;
}

function countTextWords(text: string) {
  return text.replace(/\s+/g, "").length;
}

async function interpret(config: AxiosRequestConfig, body: Record<string, any>) {
  const idea = asString(body.idea);
  if (!idea) fail(config, 400, "请输入故事灵感。");

  const response = await mobileWorkflowApiAdapter(config as any);
  const interpretation = normalizeInterpretation(extractAiData(response), { ...body, idea });
  const db = await loadDb();
  const task = {
    taskId: makeId("creation"),
    idea,
    status: "waiting_approval",
    stageLabel: "等待确认",
    progress: 100,
    currentAction: "已生成两个创作方向，请选择后继续。",
    interpretation,
    selectedDirectionId: null,
    narrativeForm: null,
    novelId: null,
    productionTaskId: null,
    resumeRoute: null,
    error: null,
    createdAt: now(),
    updatedAt: now(),
  };
  taskList(db).unshift(task);
  await saveDb(db);
  return ok(config, taskProjection(task), 201);
}

async function regenerate(config: AxiosRequestConfig, taskId: string, body: Record<string, any>) {
  const db = await loadDb();
  const { tasks, index, task } = findTask(db, taskId);
  if (!task || index < 0) fail(config, 404, "创作任务不存在。");

  try {
    const response = await delegateAi(config, `/creation-studio/${taskId}/regenerate`, {
      ...body,
      idea: task.idea,
      previousInterpretation: task.interpretation,
      instruction: "根据用户反馈重新生成完整 interpretation，必须包含恰好两个 directions。",
    });
    const interpretation = normalizeInterpretation(extractAiData(response), { idea: task.idea }, task.interpretation);
    tasks[index] = {
      ...task,
      status: "waiting_approval",
      stageLabel: "等待确认",
      progress: 100,
      currentAction: "已按反馈重新生成两个创作方向。",
      interpretation,
      selectedDirectionId: null,
      error: null,
      updatedAt: now(),
    };
    await saveDb(db);
    return ok(config, taskProjection(tasks[index]));
  } catch (error: any) {
    tasks[index] = { ...task, error: error?.message || "重新生成失败", updatedAt: now() };
    await saveDb(db);
    throw error;
  }
}

async function generateShortStory(config: AxiosRequestConfig, task: Record<string, any>, novel: Record<string, any>, direction: Record<string, any>) {
  try {
    const response = await delegateAi(config, `/novels/${novel.id}/chapters/short-story-draft/generate`, {
      instruction: "基于给定灵感与方向生成一篇完整、可直接编辑的中文短篇小说。只返回 JSON，字段至少包含 title、content、summary、targetWordCount。content 必须是完整正文字符串，不要只给大纲。",
      idea: task.idea,
      interpretation: task.interpretation,
      selectedDirection: direction,
      narrativeForm: "short_story",
      writingPlatform: novel.writingPlatform,
      targetWordCount: 5000,
    });
    const generated = extractAiData(response) || {};
    const chapterLike = generated.chapter && typeof generated.chapter === "object" ? generated.chapter : generated;
    const content = asString(chapterLike.content, asString(chapterLike.text));
    return {
      title: asString(chapterLike.title, novel.title),
      content,
      summary: asString(chapterLike.summary, direction.summary),
      targetWordCount: Number(chapterLike.targetWordCount) > 0 ? Number(chapterLike.targetWordCount) : 5000,
      error: content ? null : "DeepSeek 未返回完整正文，可进入编辑页继续生成或手动编辑。",
    };
  } catch (error: any) {
    return {
      title: novel.title,
      content: "",
      summary: direction.summary,
      targetWordCount: 5000,
      error: error?.message || "短篇初稿生成失败，可进入编辑页重试。",
    };
  }
}

async function confirm(config: AxiosRequestConfig, taskId: string, body: Record<string, any>) {
  let db = await loadDb();
  const found = findTask(db, taskId);
  if (!found.task || found.index < 0) fail(config, 404, "创作任务不存在。");
  const task = found.task;
  const interpretation = task.interpretation;
  if (!interpretation) fail(config, 409, "创作方向尚未生成。");

  const directions = Array.isArray(interpretation.directions) ? interpretation.directions : [];
  const direction = directions.find((item: any) => item.id === body.directionId) ?? directions[0];
  if (!direction) fail(config, 400, "请选择创作方向。");

  const narrativeForm = normalizeNarrativeForm(body.narrativeForm, normalizeNarrativeForm(interpretation.recommendedNarrativeForm));
  const writingPlatform = normalizePlatform(body.writingPlatform, normalizePlatform(interpretation.recommendedWritingPlatform));
  const timestamp = now();
  const novelId = makeId("novel");
  const title = asString(direction.title, asString(task.idea).slice(0, 30) || "未命名作品");
  const novel: Record<string, any> = {
    id: novelId,
    title,
    description: asString(direction.summary, interpretation.expandedIdea) || null,
    targetAudience: interpretation.targetAudience ?? null,
    bookSellingPoint: interpretation.coreSellingPoint ?? direction.whyItWorks ?? null,
    competingFeel: interpretation.competingFeel ?? null,
    first30ChapterPromise: interpretation.first30ChapterPromise ?? null,
    commercialTags: asStringArray(interpretation.commercialTags),
    status: "draft",
    writingMode: interpretation.recommendedWritingMode === "continuation" ? "continuation" : "original",
    projectMode: body.projectMode || "co_pilot",
    creationExperience: "professional",
    narrativeForm,
    targetWordCount: narrativeForm === "short_story" ? 5000 : null,
    writingPlatform,
    narrativePov: null,
    pacePreference: null,
    styleTone: asStringArray(interpretation.toneKeywords).join(" / ") || null,
    emotionIntensity: null,
    aiFreedom: null,
    postGenerationStyleReviewEnabled: true,
    defaultChapterLength: null,
    estimatedChapterCount: narrativeForm === "short_story" ? 1 : null,
    projectStatus: "in_progress",
    storylineStatus: "not_started",
    outlineStatus: "not_started",
    resourceReadyScore: 0,
    sourceNovelId: interpretation.continuationContext?.sourceNovelId ?? null,
    worldId: null,
    outline: null,
    structuredOutline: null,
    creativeDirection: direction,
    creationStudioTaskId: taskId,
    createdAt: timestamp,
    updatedAt: timestamp,
    _count: { chapters: 0, characters: 0, plotBeats: 0 },
  };

  collection(db, "novels").unshift(novel);
  await saveDb(db);

  let shortStoryError: string | null = null;
  if (narrativeForm === "short_story") {
    const draft = await generateShortStory(config, task, novel, direction);
    db = await loadDb();
    const chapters = nested(db, `novels:${novelId}:chapters`);
    const chapter = {
      id: makeId("chapter"),
      novelId,
      title: draft.title,
      order: 1,
      content: draft.content,
      expectation: draft.summary,
      chapterStatus: draft.content ? "completed" : "pending_generation",
      targetWordCount: draft.targetWordCount,
      conflictLevel: null,
      revealLevel: null,
      mustAvoid: "",
      taskSheet: "",
      sceneCards: "",
      repairHistory: "",
      qualityScore: null,
      continuityScore: null,
      characterScore: null,
      pacingScore: null,
      riskFlags: "",
      createdAt: now(),
      updatedAt: now(),
    };
    chapters.push(chapter);
    const novelIndex = collection(db, "novels").findIndex((item) => item.id === novelId);
    if (novelIndex >= 0) {
      collection(db, "novels")[novelIndex] = {
        ...collection(db, "novels")[novelIndex],
        _count: { chapters: 1, characters: 0, plotBeats: 0 },
        updatedAt: now(),
      };
    }
    shortStoryError = draft.error;
  }

  const latest = findTask(db, taskId);
  if (latest.index < 0) fail(config, 500, "创作任务状态丢失。");
  const resumeRoute = `/novels/${novelId}/edit`;
  latest.tasks[latest.index] = {
    ...latest.task,
    status: "succeeded",
    stageLabel: "已创建作品",
    progress: 100,
    currentAction: narrativeForm === "short_story"
      ? (shortStoryError ? "短篇项目已创建，初稿未完整生成，可进入编辑页继续。" : "短篇初稿已生成，可进入编辑页继续修改。")
      : "长篇项目已创建，可进入项目编辑页继续世界观、人物、卷章与生产流程。",
    selectedDirectionId: direction.id,
    narrativeForm,
    novelId,
    productionTaskId: null,
    resumeRoute,
    error: shortStoryError,
    updatedAt: now(),
  };
  await saveDb(db);

  return ok(config, {
    taskId,
    novelId,
    productionTaskId: null,
    narrativeForm,
    resumeRoute,
  });
}

async function shortStoryProjection(config: AxiosRequestConfig, taskId: string) {
  const db = await loadDb();
  const { task } = findTask(db, taskId);
  if (!task) fail(config, 404, "创作任务不存在。");
  if (!task.novelId) fail(config, 409, "该任务尚未创建作品。");

  const novel = collection(db, "novels").find((item) => item.id === task.novelId);
  if (!novel) fail(config, 404, "作品不存在。");
  const chapter = nested(db, `novels:${task.novelId}:chapters`).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0))[0] ?? null;
  const content = asString(chapter?.content);
  return ok(config, {
    taskId,
    novel: {
      id: novel.id,
      title: novel.title,
      description: novel.description ?? null,
      narrativeForm: novel.narrativeForm,
      writingPlatform: novel.writingPlatform,
      projectStatus: novel.projectStatus ?? null,
      storylineStatus: novel.storylineStatus ?? null,
      outlineStatus: novel.outlineStatus ?? null,
    },
    chapter,
    planning: {
      status: task.status === "failed" ? "failed" : (task.status === "succeeded" ? "succeeded" : "waiting_approval"),
      progress: Number(task.progress || 0),
      currentAction: task.currentAction || "",
      error: task.error ?? null,
    },
    totalWords: countTextWords(content),
    targetWordCount: chapter?.targetWordCount ?? novel.targetWordCount ?? null,
    readyToEdit: Boolean(chapter),
  });
}

export const mobileCreationApiAdapter: AxiosAdapter = async (config: any) => {
  const path = normalizePath(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);
  const parts = path.split("/").filter(Boolean);

  if (parts[0] !== "creation-studio") return mobileWorkflowApiAdapter(config);

  if (parts.length === 2 && parts[1] === "interpret" && method === "post") {
    return interpret(config, body);
  }

  if (parts.length >= 2 && parts[1] !== "interpret") {
    const taskId = parts[1];
    if (parts.length === 2 && method === "get") {
      const db = await loadDb();
      const { task } = findTask(db, taskId);
      if (!task) fail(config, 404, "创作任务不存在。");
      return ok(config, taskProjection(task));
    }
    if (parts.length === 3 && parts[2] === "regenerate" && method === "post") {
      return regenerate(config, taskId, body);
    }
    if (parts.length === 3 && parts[2] === "confirm" && method === "post") {
      return confirm(config, taskId, body);
    }
    if (parts.length === 3 && parts[2] === "short-story" && method === "get") {
      return shortStoryProjection(config, taskId);
    }
  }

  return mobileWorkflowApiAdapter(config);
};
