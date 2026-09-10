import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import { get, set } from "idb-keyval";
import { mobileWorkflowApiAdapter } from "./workflowAdapter";

const DB_KEY = "ai-novel.mobile.local-db.v1";
const WRITING_PLATFORMS = new Set(["fanqie_free", "qidian_male", "jinjiang_female", "zhihu_story"]);
const REVISION_STRATEGIES = new Set(["local_patch", "rewrite_downstream", "full_replan"]);

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

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeNarrativeForm(value: unknown, fallback: "short_story" | "long_novel" = "short_story") {
  return value === "short_story" || value === "long_novel" ? value : fallback;
}

function normalizeTargetWordCount(form: "short_story" | "long_novel", value: unknown, fallback?: number) {
  const base = asNumber(value, fallback ?? (form === "short_story" ? 8000 : 200000));
  return form === "short_story" ? clamp(base, 3000, 30000) : clamp(base, 50000, 3_000_000);
}

function normalizePlatform(value: unknown, fallback = "fanqie_free") {
  return typeof value === "string" && WRITING_PLATFORMS.has(value) ? value : fallback;
}

function normalizeConfidence(value: unknown, fallback = 0.75) {
  const number = asNumber(value, fallback);
  return Math.min(1, Math.max(0, number));
}

function normalizeDirection(raw: any, index: number, seed: { idea: string; understanding: string }) {
  const defaults = index === 0
    ? {
        title: "主线推进",
        premise: seed.understanding || seed.idea,
        coreExperience: "目标明确、冲突持续升级，并在关键节点兑现阅读期待。",
        protagonist: "一个必须主动改变现状、为选择承担代价的主角。",
        centralConflict: "主角的核心目标与现实阻碍发生正面冲突。",
        endingPromise: "核心矛盾得到阶段性兑现，同时留下人物改变后的余韵。",
        styleKeywords: ["强冲突", "清晰主线", "人物驱动"],
      }
    : {
        title: "反转强化",
        premise: `围绕“${seed.idea}”强化信息差、误判和代价，让故事在关键节点发生方向变化。`,
        coreExperience: "通过递进误导和反转制造更强钩子，同时保证反转来自人物选择。",
        protagonist: "一个最初相信错误答案，随后被迫重构认知的主角。",
        centralConflict: "表层目标与隐藏真相相互牵制，主角每次推进都付出新的代价。",
        endingPromise: "以一次能改变人物未来选择的反转完成收束。",
        styleKeywords: ["悬念", "反转", "情绪回报"],
      };

  return {
    id: asString(raw?.id, makeId(`direction_${index + 1}`)),
    title: asString(raw?.title, defaults.title),
    premise: asString(raw?.premise, asString(raw?.summary, defaults.premise)),
    coreExperience: asString(raw?.coreExperience, asString(raw?.whyItWorks, defaults.coreExperience)),
    protagonist: asString(raw?.protagonist, asString(raw?.protagonistPath, defaults.protagonist)),
    centralConflict: asString(raw?.centralConflict, asString(raw?.coreConflict, defaults.centralConflict)),
    endingPromise: asString(raw?.endingPromise, asString(raw?.endingDirection, defaults.endingPromise)),
    styleKeywords: asStringArray(raw?.styleKeywords).length
      ? asStringArray(raw?.styleKeywords)
      : (asStringArray(raw?.shortFormAdjustments).length ? asStringArray(raw?.shortFormAdjustments).slice(0, 5) : defaults.styleKeywords),
  };
}

function normalizeInterpretation(raw: any, request: Record<string, any>, previous?: any) {
  const source = raw?.interpretation && typeof raw.interpretation === "object" ? raw.interpretation : (raw || {});
  const idea = asString(request.idea, asString(previous?.understanding, "待完善的故事构想"));
  const requestedForm = request.preferredNarrativeForm ?? request.narrativeForm;
  const form = normalizeNarrativeForm(
    source.recommendedNarrativeForm,
    normalizeNarrativeForm(requestedForm, normalizeNarrativeForm(previous?.recommendedNarrativeForm, "short_story")),
  );
  const targetWordCount = normalizeTargetWordCount(
    form,
    source.recommendedTargetWordCount ?? request.targetWordCount,
    previous?.recommendedTargetWordCount,
  );
  const platformPreference = request.writingPlatformPreference;
  const explicitPlatform = typeof platformPreference === "string" && platformPreference !== "ai_recommend"
    ? normalizePlatform(platformPreference)
    : null;
  const platform = explicitPlatform
    ?? normalizePlatform(source.recommendedWritingPlatform, normalizePlatform(previous?.recommendedWritingPlatform, "fanqie_free"));
  const understanding = asString(
    source.understanding,
    asString(source.expandedIdea, asString(previous?.understanding, idea)),
  );

  const interpretation: any = {
    understanding,
    recommendedNarrativeForm: form,
    recommendedTargetWordCount: targetWordCount,
    confidence: normalizeConfidence(source.confidence, normalizeConfidence(previous?.confidence, 0.78)),
    recommendationReason: asString(
      source.recommendationReason,
      asString(previous?.recommendationReason, `根据当前灵感的冲突密度与展开空间，建议先按${form === "short_story" ? "短篇" : "长篇"}规模推进。`),
    ),
    recommendedWritingPlatform: platform,
    writingPlatformConfidence: normalizeConfidence(source.writingPlatformConfidence, normalizeConfidence(previous?.writingPlatformConfidence, 0.72)),
    writingPlatformReason: asString(
      source.writingPlatformReason,
      asString(previous?.writingPlatformReason, "根据题材、目标篇幅和读者预期匹配当前平台。"),
    ),
    directions: [],
  };

  const rawDirections = Array.isArray(source.directions) ? source.directions.slice(0, 2) : [];
  interpretation.directions = [
    normalizeDirection(rawDirections[0], 0, { idea, understanding }),
    normalizeDirection(rawDirections[1], 1, { idea, understanding }),
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

function findTaskByNovel(db: LocalDb, novelId: string) {
  return taskList(db).find((item) => item.novelId === novelId) ?? null;
}

function taskProjection(task: Record<string, any>) {
  return {
    taskId: task.taskId,
    status: task.status,
    progress: Number(task.progress ?? 0),
    currentAction: task.currentAction ?? null,
    idea: task.idea,
    interpretation: task.interpretation ?? null,
    selectedDirectionId: task.selectedDirectionId ?? null,
    novelId: task.novelId ?? null,
    productionTaskId: task.productionTaskId ?? null,
    resumeRoute: task.resumeRoute ?? "",
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

function countWords(text: string) {
  return text.replace(/\s+/g, "").length;
}

function syncShortStoryChapter(db: LocalDb, novelId: string) {
  const segments = nested(db, `novels:${novelId}:short-story-segments`).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const continuousContent = segments.map((segment) => asString(segment.content)).filter(Boolean).join("\n\n");
  const chapters = nested(db, `novels:${novelId}:chapters`);
  let chapter = chapters.find((item) => Number(item.order || 0) === 1);
  if (!chapter) {
    chapter = {
      id: makeId("chapter"),
      novelId,
      title: collection(db, "novels").find((item) => item.id === novelId)?.title || "短篇正文",
      order: 1,
      content: continuousContent,
      expectation: "完整短篇正文",
      chapterStatus: continuousContent ? "completed" : "pending_generation",
      targetWordCount: segments.reduce((sum, item) => sum + Number(item.targetWordCount || 0), 0) || null,
      createdAt: now(),
      updatedAt: now(),
    };
    chapters.push(chapter);
  } else {
    chapter.content = continuousContent;
    chapter.chapterStatus = continuousContent ? "completed" : "pending_generation";
    chapter.updatedAt = now();
  }
  return chapter;
}

async function interpret(config: AxiosRequestConfig, body: Record<string, any>) {
  const idea = asString(body.idea);
  if (!idea) fail(config, 400, "请输入故事灵感。");

  const response = await mobileWorkflowApiAdapter(config as any);
  const interpretation = normalizeInterpretation(extractAiData(response), { ...body, idea });
  const db = await loadDb();
  const task = {
    taskId: makeId("creation"),
    status: "waiting_approval",
    progress: 1,
    currentAction: "已生成两个创作方向，请选择后继续。",
    idea,
    interpretation,
    selectedDirectionId: null,
    novelId: null,
    productionTaskId: null,
    resumeRoute: "",
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
      outputContract: "返回 CreationIntentInterpretation：understanding、recommendedNarrativeForm、recommendedTargetWordCount、confidence、recommendationReason、recommendedWritingPlatform、writingPlatformConfidence、writingPlatformReason，以及恰好两个 directions。每个 direction 包含 id/title/premise/coreExperience/protagonist/centralConflict/endingPromise/styleKeywords。",
    });
    const interpretation = normalizeInterpretation(extractAiData(response), { ...body, idea: task.idea }, task.interpretation);
    tasks[index] = {
      ...task,
      status: "waiting_approval",
      progress: 1,
      currentAction: "已按新的作品规模和平台重新生成两个方向。",
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

async function generateShortStoryDraft(
  config: AxiosRequestConfig,
  task: Record<string, any>,
  novel: Record<string, any>,
  direction: Record<string, any>,
  targetWordCount: number,
) {
  const response = await delegateAi(config, `/novels/${novel.id}/chapters/short-story-draft/generate`, {
    instruction: "生成完整中文短篇小说正文。只返回 JSON：{title, content, summary}。content 必须是连续完整正文，不是提纲，不要省略结尾。",
    originalIdea: task.idea,
    understanding: task.interpretation?.understanding,
    selectedDirection: direction,
    targetWordCount,
    writingPlatform: novel.writingPlatform,
  });
  const generated = extractAiData(response) || {};
  const chapterLike = generated.chapter && typeof generated.chapter === "object" ? generated.chapter : generated;
  const content = asString(chapterLike.content, asString(chapterLike.text));
  if (!content) throw new Error("DeepSeek 未返回完整短篇正文。");
  return {
    title: asString(chapterLike.title, novel.title),
    content,
    summary: asString(chapterLike.summary, direction.premise),
  };
}

function createShortStoryState(
  db: LocalDb,
  task: Record<string, any>,
  novel: Record<string, any>,
  direction: Record<string, any>,
  draft: { title: string; content: string; summary: string } | null,
  targetWordCount: number,
  error: string | null,
) {
  const timestamp = now();
  db.misc[`novels:${novel.id}:short-story-intent`] = {
    id: makeId("intent"),
    version: 1,
    originalExpression: task.idea,
    understanding: task.interpretation?.understanding || task.idea,
    direction,
  };
  db.misc[`novels:${novel.id}:short-story-plan`] = {
    id: makeId("short_plan"),
    status: draft ? "completed" : "failed",
    endingPromise: direction.endingPromise,
    qualityDebt: error ? [error] : [],
    schemaVersion: 1,
  };

  const segment = {
    id: makeId("segment"),
    order: 1,
    content: draft?.content || "",
    status: draft ? "completed" : "failed",
    version: 1,
    targetWordCount,
    wordCount: countWords(draft?.content || ""),
    humanEdited: false,
    qualityResult: null,
    updatedAt: timestamp,
  };
  db.nested[`novels:${novel.id}:short-story-segments`] = [segment];
  const chapter = syncShortStoryChapter(db, novel.id);
  if (draft?.title) chapter.title = draft.title;
  if (draft?.summary) chapter.expectation = draft.summary;
}

async function confirm(config: AxiosRequestConfig, taskId: string, body: Record<string, any>) {
  let db = await loadDb();
  const found = findTask(db, taskId);
  if (!found.task || found.index < 0) fail(config, 404, "创作任务不存在。");
  const task = found.task;
  const interpretation = task.interpretation;
  if (!interpretation) fail(config, 409, "创作方向尚未生成。");

  if (task.status === "succeeded" && task.novelId && task.confirmIdempotencyKey === body.idempotencyKey) {
    return ok(config, {
      taskId,
      novelId: task.novelId,
      productionTaskId: task.productionTaskId || taskId,
      narrativeForm: task.narrativeForm,
      resumeRoute: task.resumeRoute,
    });
  }

  const directions = Array.isArray(interpretation.directions) ? interpretation.directions : [];
  const direction = directions.find((item: any) => item.id === body.directionId) ?? directions[0];
  if (!direction) fail(config, 400, "请选择创作方向。");

  const narrativeForm = normalizeNarrativeForm(body.narrativeForm, normalizeNarrativeForm(interpretation.recommendedNarrativeForm));
  const targetWordCount = normalizeTargetWordCount(narrativeForm, body.targetWordCount, interpretation.recommendedTargetWordCount);
  const writingPlatform = normalizePlatform(body.writingPlatform, normalizePlatform(interpretation.recommendedWritingPlatform));
  const timestamp = now();
  const novelId = makeId("novel");
  const productionTaskId = makeId("production");
  const title = asString(direction.title, asString(task.idea).slice(0, 30) || "未命名作品");
  const novel: Record<string, any> = {
    id: novelId,
    title,
    description: direction.premise || interpretation.understanding || null,
    targetAudience: null,
    bookSellingPoint: direction.coreExperience || null,
    competingFeel: null,
    first30ChapterPromise: narrativeForm === "long_novel" ? direction.endingPromise : null,
    commercialTags: direction.styleKeywords || [],
    status: "draft",
    writingMode: "original",
    projectMode: "co_pilot",
    creationExperience: "professional",
    narrativeForm,
    targetWordCount,
    derivedFromNovelId: null,
    writingPlatform,
    writingPlatformProfileVersion: 1,
    narrativePov: null,
    pacePreference: null,
    styleTone: asStringArray(direction.styleKeywords).join(" / ") || null,
    emotionIntensity: null,
    aiFreedom: null,
    postGenerationStyleReviewEnabled: true,
    defaultChapterLength: null,
    estimatedChapterCount: narrativeForm === "short_story" ? 1 : null,
    projectStatus: "in_progress",
    storylineStatus: "not_started",
    outlineStatus: "not_started",
    resourceReadyScore: 0,
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

  let productionError: string | null = null;
  if (narrativeForm === "short_story") {
    let draft: { title: string; content: string; summary: string } | null = null;
    try {
      draft = await generateShortStoryDraft(config, task, novel, direction, targetWordCount);
    } catch (error: any) {
      productionError = error?.message || "短篇初稿生成失败，可从短篇工作台继续。";
    }
    db = await loadDb();
    createShortStoryState(db, task, novel, direction, draft, targetWordCount, productionError);
    const novelIndex = collection(db, "novels").findIndex((item) => item.id === novelId);
    if (novelIndex >= 0) {
      collection(db, "novels")[novelIndex] = {
        ...collection(db, "novels")[novelIndex],
        _count: { chapters: 1, characters: 0, plotBeats: 0 },
        updatedAt: now(),
      };
    }
  }

  const latest = findTask(db, taskId);
  if (!latest.task || latest.index < 0) fail(config, 500, "创作任务状态丢失。");
  const resumeRoute = narrativeForm === "short_story" ? `/novels/${novelId}/story` : `/novels/${novelId}/edit`;
  latest.tasks[latest.index] = {
    ...latest.task,
    status: productionError ? "failed" : "succeeded",
    progress: productionError ? 0 : 1,
    currentAction: narrativeForm === "short_story"
      ? (productionError ? "短篇项目已创建，正文生成中断，可进入工作台重试。" : "短篇正文已生成，可进入工作台编辑。")
      : "长篇项目已创建，可继续世界观、人物、卷章和生产流程。",
    selectedDirectionId: direction.id,
    novelId,
    productionTaskId,
    resumeRoute,
    narrativeForm,
    confirmIdempotencyKey: body.idempotencyKey || null,
    error: productionError,
    updatedAt: now(),
  };
  await saveDb(db);

  return ok(config, { taskId, novelId, productionTaskId, narrativeForm, resumeRoute });
}

function shortStoryProjectionFromDb(config: AxiosRequestConfig, db: LocalDb, novelId: string) {
  const novel = collection(db, "novels").find((item) => item.id === novelId);
  if (!novel) fail(config, 404, "作品不存在。");
  const segments = nested(db, `novels:${novelId}:short-story-segments`).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const task = findTaskByNovel(db, novelId);
  const continuousContent = segments.map((segment) => asString(segment.content)).filter(Boolean).join("\n\n");
  return {
    novel: {
      id: novel.id,
      title: novel.title,
      narrativeForm: novel.narrativeForm || "short_story",
      targetWordCount: Number(novel.targetWordCount || 8000),
      derivedFromNovelId: novel.derivedFromNovelId ?? null,
      writingPlatform: novel.writingPlatform ?? null,
      writingPlatformProfileVersion: novel.writingPlatformProfileVersion ?? null,
    },
    intent: db.misc[`novels:${novelId}:short-story-intent`] ?? null,
    plan: db.misc[`novels:${novelId}:short-story-plan`] ?? null,
    segments,
    continuousContent,
    production: {
      taskId: task?.productionTaskId ?? task?.taskId ?? null,
      status: task?.status ?? null,
      progress: Number(task?.progress ?? (continuousContent ? 1 : 0)),
      currentAction: task?.currentAction ?? null,
      error: task?.error ?? null,
    },
  };
}

async function getShortStory(config: AxiosRequestConfig, novelId: string) {
  const db = await loadDb();
  return ok(config, shortStoryProjectionFromDb(config, db, novelId));
}

async function updateShortStorySegment(config: AxiosRequestConfig, novelId: string, segmentId: string, body: Record<string, any>) {
  const db = await loadDb();
  const segments = nested(db, `novels:${novelId}:short-story-segments`);
  const index = segments.findIndex((item) => item.id === segmentId);
  if (index < 0) fail(config, 404, "正文分段不存在。");
  const current = segments[index];
  const expectedVersion = Number(body.expectedVersion);
  if (Number.isFinite(expectedVersion) && expectedVersion !== Number(current.version || 1)) {
    fail(config, 409, "正文已被更新，请刷新后再保存。");
  }
  nested(db, `novels:${novelId}:short-story-segment-history`).unshift({
    id: makeId("segment_history"), segmentId, version: current.version, content: current.content, createdAt: now(),
  });
  const content = String(body.content ?? "");
  segments[index] = {
    ...current,
    content,
    status: "completed",
    version: Number(current.version || 1) + 1,
    wordCount: countWords(content),
    humanEdited: true,
    updatedAt: now(),
  };
  syncShortStoryChapter(db, novelId);
  await saveDb(db);
  return ok(config, { id: segmentId, content, version: segments[index].version });
}

async function previewRevision(config: AxiosRequestConfig, novelId: string, body: Record<string, any>) {
  const db = await loadDb();
  const projection = shortStoryProjectionFromDb(config, db, novelId);
  const instruction = asString(body.instruction);
  if (!instruction) fail(config, 400, "请输入修改要求。");
  const response = await delegateAi(config, `/novels/${novelId}/short-story/revision-preview`, {
    instruction,
    novel: projection.novel,
    intent: projection.intent,
    plan: projection.plan,
    segments: projection.segments.map((segment: any) => ({ id: segment.id, order: segment.order, content: segment.content })),
    outputContract: "返回 JSON：understoodGoal, affectedSegmentIds, changesEnding, changesScale, changesCoreIntent, recommendedTargetWordCount, recommendedStrategy(local_patch|rewrite_downstream|full_replan), summary。",
  });
  const generated = extractAiData(response) || {};
  const allIds = projection.segments.map((segment: any) => segment.id);
  const affected = Array.isArray(generated.affectedSegmentIds)
    ? generated.affectedSegmentIds.filter((id: any) => allIds.includes(id))
    : [];
  const impact = {
    intentVersionId: makeId("revision_intent"),
    understoodGoal: asString(generated.understoodGoal, instruction),
    affectedSegmentIds: affected.length ? affected : allIds,
    changesEnding: Boolean(generated.changesEnding),
    changesScale: Boolean(generated.changesScale),
    changesCoreIntent: Boolean(generated.changesCoreIntent),
    recommendedTargetWordCount: normalizeTargetWordCount("short_story", generated.recommendedTargetWordCount, projection.novel.targetWordCount),
    recommendedStrategy: REVISION_STRATEGIES.has(generated.recommendedStrategy) ? generated.recommendedStrategy : "local_patch",
    summary: asString(generated.summary, "将按你的要求修改受影响正文，并保留未受影响内容。"),
  };
  nested(db, `novels:${novelId}:short-story-revisions`).unshift({ ...impact, instruction, createdAt: now(), status: "proposed" });
  await saveDb(db);
  return ok(config, impact);
}

async function applyRevision(config: AxiosRequestConfig, novelId: string, intentVersionId: string) {
  const db = await loadDb();
  const revisions = nested(db, `novels:${novelId}:short-story-revisions`);
  const revisionIndex = revisions.findIndex((item) => item.intentVersionId === intentVersionId);
  if (revisionIndex < 0) fail(config, 404, "修改预览已失效，请重新预览。");
  const revision = revisions[revisionIndex];
  const segments = nested(db, `novels:${novelId}:short-story-segments`);
  const selected = segments.filter((segment) => revision.affectedSegmentIds.includes(segment.id));
  if (!selected.length) fail(config, 409, "没有可修改的正文分段。");

  const response = await delegateAi(config, `/novels/${novelId}/short-story/revisions/${intentVersionId}/rewrite`, {
    instruction: revision.instruction,
    strategy: revision.recommendedStrategy,
    segments: selected.map((segment) => ({ id: segment.id, order: segment.order, content: segment.content })),
    outputContract: "返回 JSON：{segments:[{id,content}]}，id 必须沿用输入 id，content 为修改后的完整正文。",
  });
  const generated = extractAiData(response) || {};
  const generatedSegments = Array.isArray(generated.segments) ? generated.segments : [];
  for (const segment of selected) {
    const replacement = generatedSegments.find((item: any) => item.id === segment.id);
    const content = asString(replacement?.content, selected.length === 1 ? asString(generated.content) : "");
    if (!content) continue;
    nested(db, `novels:${novelId}:short-story-segment-history`).unshift({
      id: makeId("segment_history"), segmentId: segment.id, version: segment.version, content: segment.content, createdAt: now(),
    });
    const index = segments.findIndex((item) => item.id === segment.id);
    segments[index] = {
      ...segments[index],
      content,
      status: "completed",
      version: Number(segments[index].version || 1) + 1,
      wordCount: countWords(content),
      updatedAt: now(),
    };
  }
  revisions[revisionIndex] = { ...revision, status: "applied", appliedAt: now() };
  const novel = collection(db, "novels").find((item) => item.id === novelId);
  if (novel) novel.targetWordCount = revision.recommendedTargetWordCount;
  syncShortStoryChapter(db, novelId);
  await saveDb(db);
  return ok(config, { taskId: makeId("revision_task") });
}

async function retryShortStory(config: AxiosRequestConfig, novelId: string) {
  let db = await loadDb();
  const novel = collection(db, "novels").find((item) => item.id === novelId);
  if (!novel) fail(config, 404, "作品不存在。");
  const task = findTaskByNovel(db, novelId);
  if (!task) fail(config, 404, "创作任务不存在。");
  const direction = db.misc[`novels:${novelId}:short-story-intent`]?.direction ?? task.interpretation?.directions?.[0];
  if (!direction) fail(config, 409, "缺少短篇创作方向。");
  const targetWordCount = normalizeTargetWordCount("short_story", novel.targetWordCount, 8000);

  const taskIndex = taskList(db).findIndex((item) => item.taskId === task.taskId);
  if (taskIndex >= 0) {
    taskList(db)[taskIndex] = { ...task, status: "running", progress: 0.1, currentAction: "正在重新生成短篇正文…", error: null, updatedAt: now() };
    await saveDb(db);
  }

  try {
    const draft = await generateShortStoryDraft(config, task, novel, direction, targetWordCount);
    db = await loadDb();
    createShortStoryState(db, task, novel, direction, draft, targetWordCount, null);
    const latestIndex = taskList(db).findIndex((item) => item.taskId === task.taskId);
    if (latestIndex >= 0) taskList(db)[latestIndex] = { ...taskList(db)[latestIndex], status: "succeeded", progress: 1, currentAction: "短篇正文已重新生成。", error: null, updatedAt: now() };
    await saveDb(db);
    return ok(config, { taskId: task.productionTaskId || task.taskId });
  } catch (error: any) {
    db = await loadDb();
    const latestIndex = taskList(db).findIndex((item) => item.taskId === task.taskId);
    if (latestIndex >= 0) taskList(db)[latestIndex] = { ...taskList(db)[latestIndex], status: "failed", progress: 0, currentAction: "短篇生成中断，可再次重试。", error: error?.message || "生成失败", updatedAt: now() };
    await saveDb(db);
    throw error;
  }
}

async function deriveLongForm(config: AxiosRequestConfig, novelId: string) {
  const db = await loadDb();
  const projection = shortStoryProjectionFromDb(config, db, novelId);
  const baseIdea = projection.intent?.originalExpression || projection.intent?.understanding || projection.novel.title;
  let interpretation: any;
  try {
    const response = await delegateAi(config, `/novels/${novelId}/short-story/derive-long-form`, {
      instruction: "把当前短篇提炼为可扩展的长篇创作方向，返回 CreationIntentInterpretation，并提供恰好两个长篇 directions。不要直接改写原短篇。",
      shortStory: projection,
      preferredNarrativeForm: "long_novel",
      targetWordCount: Math.max(100000, Number(projection.novel.targetWordCount || 8000) * 20),
    });
    interpretation = normalizeInterpretation(extractAiData(response), {
      idea: baseIdea,
      preferredNarrativeForm: "long_novel",
      targetWordCount: Math.max(100000, Number(projection.novel.targetWordCount || 8000) * 20),
      writingPlatformPreference: "fanqie_free",
    });
  } catch {
    interpretation = normalizeInterpretation({}, {
      idea: baseIdea,
      preferredNarrativeForm: "long_novel",
      targetWordCount: Math.max(100000, Number(projection.novel.targetWordCount || 8000) * 20),
      writingPlatformPreference: "fanqie_free",
    });
  }
  const taskId = makeId("creation");
  taskList(db).unshift({
    taskId,
    status: "waiting_approval",
    progress: 1,
    currentAction: "已从短篇提炼出两个长篇扩展方向。",
    idea: baseIdea,
    interpretation,
    selectedDirectionId: null,
    novelId: null,
    productionTaskId: null,
    resumeRoute: `/create?taskId=${taskId}`,
    error: null,
    derivedFromNovelId: novelId,
    createdAt: now(),
    updatedAt: now(),
  });
  await saveDb(db);
  return ok(config, { taskId, resumeRoute: `/create?taskId=${taskId}` });
}

export const mobileCreationApiAdapter: AxiosAdapter = async (config: any) => {
  const path = normalizePath(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "creation-studio") {
    if (parts.length === 2 && parts[1] === "interpret" && method === "post") return interpret(config, body);
    if (parts.length >= 2 && parts[1] !== "interpret") {
      const taskId = parts[1];
      if (parts.length === 2 && method === "get") {
        const db = await loadDb();
        const { task } = findTask(db, taskId);
        if (!task) fail(config, 404, "创作任务不存在。");
        return ok(config, taskProjection(task));
      }
      if (parts.length === 3 && parts[2] === "regenerate" && method === "post") return regenerate(config, taskId, body);
      if (parts.length === 3 && parts[2] === "confirm" && method === "post") return confirm(config, taskId, body);
    }
    return mobileWorkflowApiAdapter(config);
  }

  if (parts[0] === "novels" && parts[1] && parts[2] === "short-story") {
    const novelId = parts[1];
    if (parts.length === 3 && method === "get") return getShortStory(config, novelId);
    if (parts.length === 4 && parts[3] === "retry" && method === "post") return retryShortStory(config, novelId);
    if (parts.length === 5 && parts[3] === "segments" && method === "put") return updateShortStorySegment(config, novelId, parts[4], body);
    if (parts.length === 4 && parts[3] === "revision-preview" && method === "post") return previewRevision(config, novelId, body);
    if (parts.length === 6 && parts[3] === "revisions" && parts[5] === "apply" && method === "post") return applyRevision(config, novelId, parts[4]);
    if (parts.length === 4 && parts[3] === "derive-long-form" && method === "post") return deriveLongForm(config, novelId);
  }

  return mobileWorkflowApiAdapter(config);
};
