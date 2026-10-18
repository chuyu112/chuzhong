/** The current artifact is a durable job, not whichever request finishes last. */
export type CurrentWork = {
  version: 1;
  nodeJobId: string;
  nodeOrder: number;
  historyAfterOrder?: number;
  capability: string;
  modelId: string;
  prompt: string;
  submittedPrompt?: string;
  promptSource?: "generation-finalized" | "submitted-job";
  executedModelId?: string | null;
  settings: Record<string, unknown>;
  resultText: string;
  assetIds: string[];
};

export function settingsRecord(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function currentWorkFromSettings(value: unknown): CurrentWork | null {
  const work = settingsRecord(settingsRecord(value).currentWork);
  return work.version === 1 && typeof work.nodeJobId === "string" &&
    Number.isSafeInteger(work.nodeOrder) && Number(work.nodeOrder) > 0 &&
    typeof work.prompt === "string" && Array.isArray(work.assetIds) &&
    work.assetIds.every(id => typeof id === "string")
    ? work as CurrentWork : null;
}

type WorkRow = {
  id: string; node_order: number; capability: string; model_id: string;
  prompt: string; generation_settings: string; result_text: string | null;
  result_asset_id: string | null; result_asset_ids: string | null;
};

/** Scope all lookups to the owner and conversation. Source access is rechecked by generate/claim. */
export async function resolveCurrentWork(
  db: D1Database, conversationId: string | undefined | null, userId: string,
  explicitAssetIds: string[] = [],
): Promise<CurrentWork | null> {
  if (!conversationId) return null;
  const columns = `id, rowid AS node_order, capability, model_id, prompt,
    generation_settings, result_text, result_asset_id, result_asset_ids`;
  const completed = `conversation_id = ? AND created_by = ? AND agent_role = 'creator'
    AND status = 'completed' AND (
      capability IN ('image', 'video', 'audio', 'edit') OR
      (channel_id IS NULL AND json_valid(generation_settings)
       AND json_extract(generation_settings, '$.creativeInterview.phase') = 'completed'
       AND json_extract(generation_settings, '$.creativeInterview.canGenerate') = 1
       AND json_type(generation_settings, '$.agentMediaTool.pendingAction') IS NULL)
    )`;
  let row: WorkRow | null = null;
  let historyAfterOrder: number | undefined;
  let focusedAssetIds: string[] | undefined;
  if (explicitAssetIds.length) {
    row = await db.prepare(`SELECT ${columns} FROM director_jobs WHERE ${completed}
      AND (result_asset_id IN (SELECT value FROM json_each(?)) OR EXISTS (
        SELECT 1 FROM json_each(CASE WHEN json_valid(result_asset_ids) THEN result_asset_ids ELSE '[]' END) a
        WHERE a.value IN (SELECT value FROM json_each(?)))) ORDER BY rowid DESC LIMIT 1`)
      .bind(conversationId, userId, JSON.stringify(explicitAssetIds), JSON.stringify(explicitAssetIds)).first<WorkRow>();
    if (row) {
      const latest = await db.prepare(`SELECT MAX(rowid) AS value FROM director_jobs
        WHERE conversation_id = ? AND created_by = ? AND agent_role = 'creator'`)
        .bind(conversationId, userId).first<{ value: number }>();
      const current = await resolveCurrentWork(db, conversationId, userId);
      historyAfterOrder = current?.nodeJobId === row.id
        ? current.historyAfterOrder || row.node_order
        : latest?.value || row.node_order;
      focusedAssetIds = explicitAssetIds;
    }
  }
  if (!row) {
    const newest = await db.prepare(`SELECT ${columns} FROM director_jobs WHERE ${completed}
      ORDER BY rowid DESC LIMIT 1`).bind(conversationId, userId).first<WorkRow>();
    // An explicit selection of an older version persists through subsequent discussion.
    const previous = await db.prepare(`SELECT rowid AS node_order, generation_settings FROM director_jobs
      WHERE conversation_id = ? AND created_by = ? AND agent_role = 'creator' AND channel_id IS NULL
        AND json_valid(generation_settings) AND json_type(generation_settings, '$.currentWork') = 'object'
      ORDER BY rowid DESC LIMIT 1`).bind(conversationId, userId)
      .first<{ node_order: number; generation_settings: string }>();
    const pinned = currentWorkFromSettings(previous?.generation_settings);
    if (pinned && previous && (!newest || (pinned.historyAfterOrder || pinned.nodeOrder) >= newest.node_order)) {
      row = await db.prepare(`SELECT ${columns} FROM director_jobs WHERE ${completed} AND id = ?`)
        .bind(conversationId, userId, pinned.nodeJobId).first<WorkRow>();
      if (row) {
        historyAfterOrder = pinned.historyAfterOrder || pinned.nodeOrder;
        focusedAssetIds = pinned.assetIds;
      }
    }
    row ||= newest;
  }
  if (!row) return null;
  let ids: string[] = [];
  try { ids = JSON.parse(row.result_asset_ids || "[]"); } catch { /* single-result legacy job */ }
  if (!Array.isArray(ids)) ids = [];
  if (!ids.length && row.result_asset_id) ids = [row.result_asset_id];
  if (focusedAssetIds?.length) {
    const focused = focusedAssetIds.filter(id => ids.includes(id));
    if (focused.length) ids = focused;
  }
  const original = settingsRecord(row.generation_settings);
  const settings = Object.fromEntries(Object.entries(original).filter(([, v]) =>
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
  // The immutable receipt can differ from the submitted brief (provider wrapping/fallback).
  // Never copy upload URLs, credentials, or the rest of the execution manifest into chat.
  const executed = ids.length ? await db.prepare(`SELECT v.prompt, v.generation_parameters, v.model_id
    FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.asset_id IN (SELECT value FROM json_each(?)) AND v.source_job_id=?
      AND v.created_by=? AND a.created_by=? AND a.deleted_at IS NULL
      AND v.event_type='generation-finalized' AND length(trim(COALESCE(v.prompt,'')))>0
    ORDER BY v.asset_version DESC LIMIT 1`)
    .bind(JSON.stringify(ids), row.id, userId, userId)
    .first<{ prompt: string; generation_parameters: string; model_id: string | null }>() : null;
  return {
    version: 1, nodeJobId: row.id, nodeOrder: row.node_order,
    historyAfterOrder: historyAfterOrder || row.node_order, capability: row.capability,
    modelId: row.model_id, prompt: executed?.prompt || row.prompt, submittedPrompt: row.prompt,
    promptSource: executed ? "generation-finalized" : "submitted-job", executedModelId: executed?.model_id || null,
    settings: executed ? settingsRecord(executed.generation_parameters) : settings, resultText: row.result_text || "",
    assetIds: ids.filter(id => typeof id === "string").slice(0, 10),
  };
}

export function currentWorkInstruction(work: CurrentWork | null | undefined): string {
  if (!work) return "";
  return `当前工作节点提供已有作品和素材上下文，不锁定当前模式或模型。根据员工本轮自然语言决定继续改图、图生视频、写文案/脚本或切换话题，不要求退出模式；引用作品时先查看实际素材或其内容分析；提示词描述不代表成品实际效果。promptSource 为 generation-finalized 时使用已核验执行提示词/参数，submittedPrompt 仅保留提交原稿；submitted-job 表示历史缺少最终执行回执，不冒称已核验执行内容。\n${JSON.stringify(work)}\n从该作品、实际生成提示词与本节点的新要求继续。旧作品的九问与未采用的设想不补回；当前作品自身已确认的取舍继续沿用，明确修改直接完成，确需重新选择时更新对应原题，不在正文另起选择题。局部修改不重启九问；新创作按本轮意图处理。历史可供追溯与按需引用，长期偏好不能覆盖当前明确要求。多份作品的修改对象不明确时先确认，不猜测。生成失败不推进节点。`;
}
