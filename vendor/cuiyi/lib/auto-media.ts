import { normalizeAgentMediaTool, type AgentMediaAction, type AgentMediaTool } from "./agent-media-tool.ts";
import { publicMediaModels } from "./model-catalog.ts";

export function automaticMediaTools(catalog?: string): AgentMediaTool[] {
  return publicMediaModels(catalog).filter(model => model.available).flatMap(model => {
    const capability = model.category === "music" || model.category === "voice" ? "audio" : model.category;
    const tool = normalizeAgentMediaTool({ capability, modelId: model.id, selectionConfirmed: true,
      executionMode: "manual", mediaSettings: {} }, catalog);
    return tool ? [tool] : [];
  });
}

/** Preparation only. This payload can never enqueue a paid job without employee confirmation. */
export function normalizeMediaProposal(value: unknown, tools: AgentMediaTool[], allowedAssetIds: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["category", "modelId", "prompt", "settings", "sourceAssetIds", "requiresReferenceImage", "operation", "referenceFrom"].includes(key))) return null;
  if (!["new", "edit-existing"].includes(String(input.operation))) return null;
  if (input.referenceFrom !== undefined && (input.referenceFrom !== "image" || input.category !== "video")) return null;
  const tool = tools.find(candidate => candidate.category === input.category &&
    (input.modelId === undefined || candidate.modelId === input.modelId));
  if (!tool || !Array.isArray(input.sourceAssetIds) || input.sourceAssetIds.length > 10 ||
    input.sourceAssetIds.some(id => typeof id !== "string" || !allowedAssetIds.includes(id)) ||
    new Set(input.sourceAssetIds).size !== input.sourceAssetIds.length ||
    (input.operation === "edit-existing" && input.sourceAssetIds.length === 0)) return null;
  if (typeof input.prompt !== "string" || input.prompt.trim().length < 2 || input.prompt.length > 40000 ||
    typeof input.requiresReferenceImage !== "boolean" ||
    (input.settings !== undefined && (!input.settings || typeof input.settings !== "object" || Array.isArray(input.settings)))) return null;
  const requested = { ...tool.settings, ...(input.settings as Record<string, unknown> || {}) };
  if (Object.entries(requested).some(([key, value]) => !tool.settingOptions.some(field =>
    field.key === key && field.options.some(option => option.value === value)))) return null;
  const action: AgentMediaAction = { prompt: input.prompt.trim(), settings: requested as AgentMediaAction["settings"],
    requiresReferenceImage: input.requiresReferenceImage, sourceAssetIds: input.sourceAssetIds as string[] };
  return action ? { tool: { ...tool, executionMode: "manual" as const, ...(input.referenceFrom === "image" ? { referenceFrom: "image" as const } : {}) }, action,
    assetIds: input.sourceAssetIds as string[], operation: input.operation } : null;
}

export function automaticMediaInstruction(tools: AgentMediaTool[]): string {
  return `根据本轮自然语言与实际素材自动选择当前能力和媒体模型，图片/视频/音乐/语音是可调用的工具，负责理解对话的聊天模型不随之切换。上一轮生图不锁定后续能力：可以继续改图、引用它生成视频、写文案或脚本，也可以换话题；不要求开启/退出口令或切换模式按钮。已生成素材保留作上下文，是否引用由本轮意图决定；跨媒介任务重新选择符合当前目标和可用参数的 modelId，不机械沿用上一轮模型。只写提示词、讨论或评价时不要准备生成。员工同时要求多种作品时，必须为每个交付项分别调用 prepare_media_generation，不能只准备最后一项；返回值中的已登记列表才是实际存在的确认卡。图片和视频要求同一主体、同一场景时，先登记图片，再登记视频并填写 referenceFrom=image，视频确认前等待图片完成并自动引用真实原图，不可只靠相同提示词冒称主体一致。员工要求实际制作时，在最后一步调用 prepare_media_generation，生成聊天中的确认卡；卡片允许员工选择模型和参数，点击确认前没有开始付费生成。首次新创作保留九问流程；当前作品的明确修改使用 edit-existing，先登记 direct-answer，无需重新九问。准确填写 sourceAssetIds：只能选本轮已授权素材的 ID；新创作可以空数组，修改现有作品必须传实际源素材。多个可能对象不明确时先确认。提示词必须完整承接当前节点实际提示词与本轮修改，不回灌旧问卷。选模型优先沿用当前作品同类模型，另有明确要求时遵守要求。不得声称已经生成或付费提交。\n可用媒体模型与真实参数：\n${JSON.stringify(tools.map(tool => ({ category: tool.category, modelId: tool.modelId, label: tool.modelLabel, settings: tool.settings, options: tool.settingOptions })))}`;
}
