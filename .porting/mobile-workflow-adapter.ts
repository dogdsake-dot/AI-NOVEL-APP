import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import { get, set } from "idb-keyval";
import { extendedMobileApiAdapter } from "./extensions";

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
  return { data: { success: true, data }, status, statusText: status === 201 ? "Created" : "OK", headers: {}, config: config as any };
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

function findNovel(db: LocalDb, novelId: string) {
  const novels = collection(db, "novels");
  const index = novels.findIndex((item) => item.id === novelId);
  return { novels, index, novel: index >= 0 ? novels[index] : undefined };
}

function withTimestamps<T extends Record<string, any>>(value: T, existing?: Record<string, any>) {
  const timestamp = now();
  return { ...existing, ...value, createdAt: existing?.createdAt ?? value.createdAt ?? timestamp, updatedAt: timestamp };
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function changedLineCount(a: unknown, b: unknown) {
  const left = String(a ?? "").split(/\r?\n/);
  const right = String(b ?? "").split(/\r?\n/);
  const count = Math.max(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < count; i += 1) if ((left[i] ?? "") !== (right[i] ?? "")) changed += 1;
  return changed;
}

function normalizeVolume(novelId: string, volume: Record<string, any>, index: number) {
  return withTimestamps({
    id: volume.id || makeId("volume"),
    novelId,
    sortOrder: Number(volume.sortOrder ?? volume.order ?? index + 1),
    title: volume.title || `第 ${index + 1} 卷`,
    summary: volume.summary ?? null,
    openingHook: volume.openingHook ?? null,
    mainPromise: volume.mainPromise ?? null,
    primaryPressureSource: volume.primaryPressureSource ?? null,
    coreSellingPoint: volume.coreSellingPoint ?? null,
    escalationMode: volume.escalationMode ?? null,
    protagonistChange: volume.protagonistChange ?? null,
    midVolumeRisk: volume.midVolumeRisk ?? null,
    climax: volume.climax ?? null,
    payoffType: volume.payoffType ?? null,
    nextVolumeHook: volume.nextVolumeHook ?? null,
    resetPoint: volume.resetPoint ?? null,
    openPayoffs: Array.isArray(volume.openPayoffs) ? volume.openPayoffs : [],
    status: volume.status || "draft",
    sourceVersionId: volume.sourceVersionId ?? null,
    chapters: Array.isArray(volume.chapters) ? volume.chapters : [],
    ...volume,
  }, volume);
}

function defaultVolumeWorkspace(db: LocalDb, novelId: string, novel: Record<string, any>) {
  const current = db.misc[`novels:${novelId}:volume-workspace`];
  if (current && typeof current === "object") return current;
  const volumes = nested(db, `novels:${novelId}:volumes`).map((item, index) => normalizeVolume(novelId, item, index));
  return {
    novelId,
    workspaceVersion: "v2",
    volumes,
    strategyPlan: null,
    critiqueReport: null,
    beatSheets: [],
    rebalanceDecisions: [],
    readiness: {
      canGenerateStrategy: true,
      canGenerateSkeleton: true,
      canGenerateBeatSheet: volumes.length > 0,
      canGenerateChapterList: volumes.length > 0,
      blockingReasons: [],
    },
    derivedOutline: novel.outline || "",
    derivedStructuredOutline: novel.structuredOutline || "",
    source: volumes.length ? "volume" : "empty",
    activeVersionId: null,
  };
}

function persistVolumeWorkspace(db: LocalDb, novelId: string, workspace: Record<string, any>) {
  const normalized = {
    novelId,
    workspaceVersion: "v2",
    strategyPlan: null,
    critiqueReport: null,
    beatSheets: [],
    rebalanceDecisions: [],
    readiness: { canGenerateStrategy: true, canGenerateSkeleton: true, canGenerateBeatSheet: true, canGenerateChapterList: true, blockingReasons: [] },
    derivedOutline: "",
    derivedStructuredOutline: "",
    source: "volume",
    activeVersionId: null,
    ...workspace,
  };
  normalized.volumes = (Array.isArray(workspace.volumes) ? workspace.volumes : []).map((item: any, index: number) => normalizeVolume(novelId, item, index));
  db.misc[`novels:${novelId}:volume-workspace`] = normalized;
  db.nested[`novels:${novelId}:volumes`] = normalized.volumes;
  return normalized;
}

function payoffLedger(db: LocalDb, novelId: string) {
  const items = nested(db, `novels:${novelId}:payoff-ledger`);
  const pending = items.filter((item) => ["setup", "hinted", "pending_payoff"].includes(item.currentStatus));
  const overdue = items.filter((item) => item.currentStatus === "overdue");
  return {
    summary: {
      totalCount: items.length,
      pendingCount: pending.length,
      urgentCount: items.filter((item) => (item.riskSignals || []).some((signal: any) => ["high", "critical"].includes(signal.severity))).length,
      overdueCount: overdue.length,
      paidOffCount: items.filter((item) => item.currentStatus === "paid_off").length,
      failedCount: items.filter((item) => item.currentStatus === "failed").length,
      updatedAt: now(),
    },
    items,
    updatedAt: now(),
  };
}

async function handleStoryline(config: AxiosRequestConfig, db: LocalDb, novelId: string, parts: string[], method: string, body: Record<string, any>) {
  if (parts[2] !== "storyline") return null;
  const versions = nested(db, `novels:${novelId}:storyline-versions`);

  if (parts[3] === "versions" && parts.length === 4 && method === "get") return ok(config, versions.slice().sort((a, b) => Number(b.version || 0) - Number(a.version || 0)));

  if (parts[3] === "versions" && parts[4] === "draft" && method === "post") {
    const version = withTimestamps({
      id: makeId("storyline"), novelId,
      version: Math.max(0, ...versions.map((item) => Number(item.version || 0))) + 1,
      status: "draft",
      content: String(body.content || ""),
      diffSummary: body.diffSummary ?? null,
    });
    versions.unshift(version);
    await saveDb(db);
    return ok(config, version, 201);
  }

  if (parts[3] === "versions" && parts[4]) {
    const versionId = parts[4];
    const index = versions.findIndex((item) => item.id === versionId);
    if (index < 0) return null;

    if (parts[5] === "activate" && method === "post") {
      for (let i = 0; i < versions.length; i += 1) {
        if (versions[i].status === "active" && i !== index) versions[i] = withTimestamps({ status: "frozen" }, versions[i]);
      }
      versions[index] = withTimestamps({ status: "active" }, versions[index]);
      const { novels, index: novelIndex, novel } = findNovel(db, novelId);
      if (novelIndex >= 0 && novel) novels[novelIndex] = withTimestamps({ storyline: versions[index].content, storylineStatus: "completed" }, novel);
      await saveDb(db);
      return ok(config, versions[index]);
    }

    if (parts[5] === "freeze" && method === "post") {
      versions[index] = withTimestamps({ status: "frozen" }, versions[index]);
      await saveDb(db);
      return ok(config, versions[index]);
    }

    if (parts[5] === "diff" && method === "get") {
      const compareVersion = Number((config.params as any)?.compareVersion || 0);
      const base = versions.find((item) => Number(item.version) === compareVersion)
        ?? versions.filter((item) => Number(item.version) < Number(versions[index].version)).sort((a, b) => Number(b.version) - Number(a.version))[0];
      return ok(config, {
        id: versions[index].id,
        novelId,
        version: Number(versions[index].version || 0),
        status: versions[index].status || "draft",
        diffSummary: versions[index].diffSummary ?? null,
        changedLines: changedLineCount(base?.content, versions[index].content),
        affectedCharacters: 0,
        affectedChapters: 0,
      });
    }
  }

  return null;
}

async function handleVolumes(config: AxiosRequestConfig, db: LocalDb, novelId: string, novel: Record<string, any>, parts: string[], method: string, body: Record<string, any>) {
  if (parts[2] !== "volumes") return null;
  const versions = nested(db, `novels:${novelId}:volume-versions`);

  if (parts.length === 3 && method === "get") return ok(config, defaultVolumeWorkspace(db, novelId, novel));

  if (parts.length === 3 && method === "put") {
    const workspace = persistVolumeWorkspace(db, novelId, body);
    const { novels, index } = findNovel(db, novelId);
    if (index >= 0) novels[index] = withTimestamps({ outline: workspace.derivedOutline || novels[index].outline || null, structuredOutline: workspace.derivedStructuredOutline || novels[index].structuredOutline || null, outlineStatus: "completed" }, novels[index]);
    await saveDb(db);
    return ok(config, workspace);
  }

  if (parts[3] === "generate" && method === "post") {
    const response = await extendedMobileApiAdapter(config as any);
    const generated = response?.data?.data;
    if (generated && typeof generated === "object") {
      const workspace = persistVolumeWorkspace(db, novelId, generated);
      await saveDb(db);
      response.data.data = workspace;
    }
    return response;
  }

  if (parts[3] === "versions" && parts.length === 4 && method === "get") {
    return ok(config, versions.map(({ contentJson, ...summary }) => summary));
  }

  if (parts[3] === "versions" && parts[4] === "draft" && method === "post") {
    const workspace = { ...defaultVolumeWorkspace(db, novelId, novel), ...body };
    const version = withTimestamps({
      id: makeId("volume_version"), novelId,
      version: Math.max(0, ...versions.map((item) => Number(item.version || 0))) + 1,
      status: "draft",
      diffSummary: body.diffSummary ?? null,
      contentJson: JSON.stringify(workspace),
    });
    versions.unshift(version);
    await saveDb(db);
    return ok(config, version, 201);
  }

  if (parts[3] === "versions" && parts[4]) {
    const versionId = parts[4];
    const index = versions.findIndex((item) => item.id === versionId);
    if (index < 0) return null;
    if (parts.length === 5 && method === "get") return ok(config, versions[index]);

    if (parts[5] === "activate" && method === "post") {
      for (let i = 0; i < versions.length; i += 1) {
        if (versions[i].status === "active" && i !== index) versions[i] = withTimestamps({ status: "frozen" }, versions[i]);
      }
      versions[index] = withTimestamps({ status: "active" }, versions[index]);
      try {
        const workspace = JSON.parse(versions[index].contentJson || "{}");
        persistVolumeWorkspace(db, novelId, { ...workspace, activeVersionId: versionId });
      } catch { /* keep version even if old content is malformed */ }
      await saveDb(db);
      return ok(config, versions[index]);
    }

    if (parts[5] === "freeze" && method === "post") {
      versions[index] = withTimestamps({ status: "frozen" }, versions[index]);
      await saveDb(db);
      return ok(config, versions[index]);
    }

    if (parts[5] === "diff" && method === "get") {
      const current = (() => { try { return JSON.parse(versions[index].contentJson || "{}"); } catch { return {}; } })();
      const compareVersion = Number((config.params as any)?.compareVersion || 0);
      const baseVersion = versions.find((item) => Number(item.version) === compareVersion)
        ?? versions.filter((item) => Number(item.version) < Number(versions[index].version)).sort((a, b) => Number(b.version) - Number(a.version))[0];
      const base = (() => { try { return JSON.parse(baseVersion?.contentJson || "{}"); } catch { return {}; } })();
      const currentVolumes = Array.isArray(current.volumes) ? current.volumes : [];
      const baseVolumes = Array.isArray(base.volumes) ? base.volumes : [];
      const changedVolumes = currentVolumes.filter((volume: any, i: number) => JSON.stringify(volume) !== JSON.stringify(baseVolumes[i])).map((volume: any) => ({
        sortOrder: Number(volume.sortOrder ?? 0), title: volume.title || "", changedFields: Object.keys(volume), chapterOrders: (volume.chapters || []).map((chapter: any) => Number(chapter.chapterOrder || 0)),
      }));
      return ok(config, {
        id: versions[index].id, novelId, version: Number(versions[index].version || 0), status: versions[index].status || "draft", diffSummary: versions[index].diffSummary ?? null,
        changedLines: changedLineCount(baseVersion?.contentJson, versions[index].contentJson), changedVolumeCount: changedVolumes.length,
        changedChapterCount: changedVolumes.reduce((sum: number, item: any) => sum + item.chapterOrders.length, 0), changedVolumes,
        affectedChapterOrders: Array.from(new Set(changedVolumes.flatMap((item: any) => item.chapterOrders))).sort((a: any, b: any) => a - b),
      });
    }
  }

  if (parts[3] === "sync-chapters" && method === "post") {
    const targetVolumes = Array.isArray(body.volumes) ? body.volumes : [];
    const chapters = nested(db, `novels:${novelId}:chapters`);
    const desired = targetVolumes.flatMap((volume: any) => (Array.isArray(volume.chapters) ? volume.chapters : []).map((chapter: any) => ({ ...chapter, volumeId: volume.id, volumeTitle: volume.title })));
    const preview: any[] = [];
    let createCount = 0;
    let updateCount = 0;
    let keepCount = 0;

    for (const target of desired) {
      const order = Number(target.chapterOrder ?? target.order ?? 0);
      const existingIndex = chapters.findIndex((chapter) => Number(chapter.order || 0) === order);
      const title = target.title || `第 ${order} 章`;
      if (existingIndex < 0) {
        chapters.push(withTimestamps({ id: target.chapterId || makeId("chapter"), novelId, order, title, content: "", chapterStatus: "unplanned", volumeId: target.volumeId, expectation: target.summary || "" }));
        preview.push({ action: "create", volumeTitle: target.volumeTitle || "", chapterOrder: order, nextTitle: title, hasContent: false, changedFields: ["title", "volumeId"] });
        createCount += 1;
      } else {
        const existing = chapters[existingIndex];
        const changedFields = [existing.title !== title ? "title" : null, existing.volumeId !== target.volumeId ? "volumeId" : null].filter(Boolean);
        if (changedFields.length) {
          chapters[existingIndex] = withTimestamps({ title, volumeId: target.volumeId, expectation: target.summary ?? existing.expectation }, existing);
          preview.push({ action: "update", volumeTitle: target.volumeTitle || "", chapterOrder: order, nextTitle: title, previousTitle: existing.title || null, hasContent: Boolean(existing.content), changedFields });
          updateCount += 1;
        } else {
          preview.push({ action: "keep", volumeTitle: target.volumeTitle || "", chapterOrder: order, nextTitle: title, previousTitle: existing.title || null, hasContent: Boolean(existing.content), changedFields: [] });
          keepCount += 1;
        }
      }
    }

    await saveDb(db);
    return ok(config, {
      createCount, updateCount, keepCount, moveCount: 0, deleteCount: 0, deleteCandidateCount: 0,
      affectedGeneratedCount: preview.filter((item) => item.hasContent && item.action !== "keep").length,
      clearContentCount: 0, affectedVolumeCount: new Set(targetVolumes.map((volume: any) => volume.id)).size, items: preview,
    });
  }

  if (parts[3] === "migrate-legacy" && method === "post") {
    const workspace = persistVolumeWorkspace(db, novelId, defaultVolumeWorkspace(db, novelId, novel));
    await saveDb(db);
    return ok(config, workspace);
  }

  return null;
}

async function handleSnapshotsAndDecisions(config: AxiosRequestConfig, db: LocalDb, novelId: string, parts: string[], method: string, body: Record<string, any>) {
  const { novels, index, novel } = findNovel(db, novelId);
  if (!novel || index < 0) return null;

  if (parts[2] === "snapshots") {
    const snapshots = nested(db, `novels:${novelId}:snapshots`);
    if (parts.length === 3 && method === "get") {
      return ok(config, snapshots.map(({ snapshotData, ...item }) => item));
    }
    if (parts.length === 3 && method === "post") {
      const snapshotData = JSON.stringify({
        novel: deepCopy(novel),
        chapters: deepCopy(nested(db, `novels:${novelId}:chapters`)),
        characters: deepCopy(nested(db, `novels:${novelId}:characters`)),
        volumes: deepCopy(nested(db, `novels:${novelId}:volumes`)),
        storylineVersions: deepCopy(nested(db, `novels:${novelId}:storyline-versions`)),
        volumeVersions: deepCopy(nested(db, `novels:${novelId}:volume-versions`)),
        volumeWorkspace: deepCopy(db.misc[`novels:${novelId}:volume-workspace`] ?? null),
        creativeDecisions: deepCopy(nested(db, `novels:${novelId}:creative-decisions`)),
      });
      const snapshot = { id: makeId("novel_snapshot"), novelId, label: body.label ?? null, triggerType: body.triggerType || "manual", snapshotData, createdAt: now() };
      snapshots.unshift(snapshot);
      await saveDb(db);
      const { snapshotData: _hidden, ...summary } = snapshot;
      return ok(config, summary, 201);
    }
    if (parts[3] === "restore" && method === "post") {
      const snapshot = snapshots.find((item) => item.id === body.snapshotId);
      if (!snapshot) fail(config, 404, "小说快照不存在");
      let data: any;
      try { data = JSON.parse(snapshot.snapshotData || "{}"); } catch { fail(config, 400, "小说快照数据损坏"); }
      novels[index] = withTimestamps({ ...(data.novel || {}), id: novelId }, novel);
      if (Array.isArray(data.chapters)) db.nested[`novels:${novelId}:chapters`] = data.chapters;
      if (Array.isArray(data.characters)) db.nested[`novels:${novelId}:characters`] = data.characters;
      if (Array.isArray(data.volumes)) db.nested[`novels:${novelId}:volumes`] = data.volumes;
      if (Array.isArray(data.storylineVersions)) db.nested[`novels:${novelId}:storyline-versions`] = data.storylineVersions;
      if (Array.isArray(data.volumeVersions)) db.nested[`novels:${novelId}:volume-versions`] = data.volumeVersions;
      if (Array.isArray(data.creativeDecisions)) db.nested[`novels:${novelId}:creative-decisions`] = data.creativeDecisions;
      if (data.volumeWorkspace) db.misc[`novels:${novelId}:volume-workspace`] = data.volumeWorkspace;
      await saveDb(db);
      return ok(config, novels[index]);
    }
  }

  if (parts[2] === "creative-decisions") {
    const decisions = nested(db, `novels:${novelId}:creative-decisions`);
    if (parts.length === 3) {
      if (method === "get") return ok(config, decisions);
      if (method === "post") {
        const decision = withTimestamps({ id: makeId("decision"), novelId, ...body });
        decisions.unshift(decision);
        await saveDb(db);
        return ok(config, decision, 201);
      }
    }
    if (parts[3] === "batch-invalidate" && method === "post") {
      const ids = new Set(Array.isArray(body.decisionIds) ? body.decisionIds : []);
      const expiresAt = Date.now();
      let count = 0;
      for (let i = 0; i < decisions.length; i += 1) {
        if (ids.has(decisions[i].id)) {
          decisions[i] = withTimestamps({ expiresAt }, decisions[i]);
          count += 1;
        }
      }
      await saveDb(db);
      return ok(config, { count, expiresAt });
    }
    if (parts[3]) {
      const decisionIndex = decisions.findIndex((item) => item.id === parts[3]);
      if (decisionIndex < 0) return null;
      if (method === "put" || method === "patch") {
        decisions[decisionIndex] = withTimestamps(body, decisions[decisionIndex]);
        await saveDb(db);
        return ok(config, decisions[decisionIndex]);
      }
      if (method === "delete") {
        decisions.splice(decisionIndex, 1);
        await saveDb(db);
        return ok(config, null);
      }
    }
  }

  return null;
}

async function handlePlanningState(config: AxiosRequestConfig, db: LocalDb, novelId: string, parts: string[], method: string) {
  if (method !== "get") return null;

  if (parts[2] === "state" && parts.length === 3) return ok(config, db.misc[`novels:${novelId}:state`] ?? null);
  if (parts[2] === "state-snapshots" && parts[3] === "latest") return ok(config, db.misc[`novels:${novelId}:state-latest`] ?? null);
  if (parts[2] === "payoff-ledger") return ok(config, payoffLedger(db, novelId));
  if (parts[2] === "chapters" && parts[3] && parts[4] === "state-snapshot") return ok(config, db.misc[`novels:${novelId}:chapters:${parts[3]}:state-snapshot`] ?? null);
  if (parts[2] === "chapters" && parts[3] && parts[4] === "plan" && parts.length === 5) return ok(config, db.misc[`novels:${novelId}:chapters:${parts[3]}:plan`] ?? null);
  if (parts[2] === "chapters" && parts[3] && parts[4] === "audit-reports") return ok(config, nested(db, `novels:${novelId}:chapters:${parts[3]}:audit-reports`));

  if (parts[2] === "quality-report") {
    const chapters = nested(db, `novels:${novelId}:chapters`);
    const reports = chapters.flatMap((chapter) => nested(db, `novels:${novelId}:chapters:${chapter.id}:audit-reports`));
    const scores = reports.map((report) => Number(report.overallScore ?? report.score?.overall ?? 0)).filter((score) => score > 0);
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return ok(config, {
      novelId,
      summary: { coherence: overall, repetition: overall, pacing: overall, voice: overall, engagement: overall, overall },
      chapterReports: reports.map((report) => ({ chapterId: report.chapterId ?? null, coherence: Number(report.score?.coherence ?? report.overallScore ?? 0), repetition: Number(report.score?.repetition ?? report.overallScore ?? 0), pacing: Number(report.score?.pacing ?? report.overallScore ?? 0), voice: Number(report.score?.voice ?? report.overallScore ?? 0), engagement: Number(report.score?.engagement ?? report.overallScore ?? 0), overall: Number(report.score?.overall ?? report.overallScore ?? 0), issues: report.summary ?? null })),
      totalReports: reports.length,
    });
  }

  return null;
}

async function persistAiPlanningResult(config: AxiosRequestConfig, db: LocalDb, novelId: string, parts: string[], method: string) {
  if (method !== "post") return null;
  const isChapterPlan = parts[2] === "chapters" && parts[3] && parts[4] === "plan" && parts[5] === "generate";
  const isChapterReview = parts[2] === "chapters" && parts[3] && parts[4] === "review";
  const isChapterAudit = parts[2] === "chapters" && parts[3] && parts[4] === "audit" && parts[5];
  if (!isChapterPlan && !isChapterReview && !isChapterAudit) return null;

  const response = await extendedMobileApiAdapter(config as any);
  const data = response?.data?.data;
  const chapterId = parts[3];
  if (isChapterPlan && data && typeof data === "object") db.misc[`novels:${novelId}:chapters:${chapterId}:plan`] = data;
  if ((isChapterReview || isChapterAudit) && data && typeof data === "object") {
    const reports = nested(db, `novels:${novelId}:chapters:${chapterId}:audit-reports`);
    if (Array.isArray(data.auditReports)) {
      for (const report of data.auditReports) {
        const existingIndex = reports.findIndex((item) => item.id && item.id === report.id);
        if (existingIndex >= 0) reports[existingIndex] = report;
        else reports.unshift(report);
      }
    }
  }
  await saveDb(db);
  return response;
}

export const mobileWorkflowApiAdapter: AxiosAdapter = async (config: any) => {
  const path = normalizePath(config);
  const method = String(config.method || "get").toLowerCase();
  const body = parseBody(config.data);
  const parts = path.split("/").filter(Boolean);

  if (parts[0] !== "novels" || !parts[1] || parts[1] === "resource-recommendation") return extendedMobileApiAdapter(config);

  const novelId = parts[1];
  const db = await loadDb();
  const { novel } = findNovel(db, novelId);
  if (!novel) return extendedMobileApiAdapter(config);

  const storyline = await handleStoryline(config, db, novelId, parts, method, body);
  if (storyline) return storyline;

  const volumes = await handleVolumes(config, db, novelId, novel, parts, method, body);
  if (volumes) return volumes;

  const snapshots = await handleSnapshotsAndDecisions(config, db, novelId, parts, method, body);
  if (snapshots) return snapshots;

  const planning = await handlePlanningState(config, db, novelId, parts, method);
  if (planning) return planning;

  const persistedAi = await persistAiPlanningResult(config, db, novelId, parts, method);
  if (persistedAi) return persistedAi;

  return extendedMobileApiAdapter(config);
};
