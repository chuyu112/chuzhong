import { legacyPromptRequiresReferenceImage, MEDIA_REFERENCE_REQUIRED_MESSAGE } from "./media-reference-policy.ts";
import {
  findMediaModel,
  isModelAllowed,
  normalizeMediaGenerationSettings,
  publicMediaModels,
  type MediaGenerationSettingDefinition,
  type MediaModelCategory,
  type MediaModelKind,
  type MediaGenerationSettings,
} from "./model-catalog.ts";

export type AgentMediaTool = {
  proposalId?: string;
  referenceFrom?: "image";
  capability: MediaModelKind;
  category: MediaModelCategory;
  selectionConfirmed: boolean;
  modelId: string;
  modelLabel: string;
  purposeLabel: string;
  settings: MediaGenerationSettings;
  settingOptions: MediaGenerationSettingDefinition[];
  alternativeModels: Array<{ id: string; label: string }>;
  executionMode: "manual" | "automatic";
  reviewEnabled: boolean;
  pendingAction?: AgentMediaAction;
  confirmedJobId?: string;
};

export type AgentMediaAction = {
  sourceAssetIds?: string[];
  prompt: string;
  requiresReferenceImage?: boolean;
  settings: MediaGenerationSettings;
  generationMode?: "text-to-image" | "image-to-image";
  referenceImageCount?: number;
};

export function withAgentMediaReferenceContext(
  action: AgentMediaAction,
  capability: MediaModelKind,
  referenceImageCount: number,
): AgentMediaAction {
  if (capability !== "image") return action;
  const count = Math.max(0, Math.min(100, Math.trunc(Number(referenceImageCount) || 0)));
  return {
    ...action,
    generationMode: count > 0 ? "image-to-image" : "text-to-image",
    referenceImageCount: count,
  };
}

const envelopeKey = "agentMediaTool";

export function normalizeAgentMediaTool(
  value: unknown,
  serializedCatalog?: string,
): AgentMediaTool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["capability", "modelId", "mediaSettings", "selectionConfirmed", "executionMode", "reviewEnabled"].includes(key))) {
    return null;
  }
  if (!(["image", "video", "audio"] as const).includes(input.capability as MediaModelKind) ||
      typeof input.modelId !== "string") return null;
  const capability = input.capability as MediaModelKind;
  const modelId = input.modelId.trim();
  const model = findMediaModel(modelId, serializedCatalog);
  if (!model || !isModelAllowed(capability, modelId, serializedCatalog)) return null;
  const settings = normalizeMediaGenerationSettings(
    modelId,
    input.mediaSettings,
    serializedCatalog,
  );
  if (!settings) return null;
  return {
    capability,
    category: model.category,
    selectionConfirmed: input.selectionConfirmed === true,
    modelId,
    modelLabel: model.label,
    purposeLabel: model.purposeLabel,
    settings,
    settingOptions: model.generationSettings || [],
    alternativeModels: publicMediaModels(serializedCatalog)
      .filter((candidate) => candidate.category === model.category && candidate.available)
      .map((candidate) => ({ id: candidate.id, label: candidate.label })),
    executionMode: input.executionMode === "automatic" ? "automatic" : "manual",
    reviewEnabled: input.reviewEnabled === true,
  };
}

export function agentMediaToolEnvelope(
  tool: AgentMediaTool,
  state: { pendingAction?: AgentMediaAction; confirmedJobId?: string } = {},
) {
  return {
    [envelopeKey]: {
      capability: tool.capability,
      modelId: tool.modelId,
      settings: tool.settings,
      selectionConfirmed: tool.selectionConfirmed,
      executionMode: tool.executionMode,
      reviewEnabled: tool.reviewEnabled,
      ...(state.pendingAction ? { pendingAction: state.pendingAction } : {}),
      ...(state.confirmedJobId ? { confirmedJobId: state.confirmedJobId } : {}),
    },
  };
}

export function agentMediaToolFromStored(
  value: unknown,
  serializedCatalog?: string,
): AgentMediaTool | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = (parsed as Record<string, unknown>)[envelopeKey];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stored = raw as Record<string, unknown>;
  const tool = normalizeAgentMediaTool({
    capability: stored.capability,
    modelId: stored.modelId,
    mediaSettings: stored.settings,
    selectionConfirmed: stored.selectionConfirmed,
    executionMode: stored.executionMode,
    reviewEnabled: stored.reviewEnabled,
  }, serializedCatalog);
  if (!tool) return null;
  const rawPendingAction = stored.pendingAction && typeof stored.pendingAction === "object" &&
      !Array.isArray(stored.pendingAction)
    ? stored.pendingAction as Record<string, unknown>
    : null;
  const normalizedPendingAction = rawPendingAction
    ? normalizeAgentMediaAction(tool, {
        prompt: rawPendingAction.prompt,
        requiresReferenceImage: rawPendingAction.requiresReferenceImage,
        settings: rawPendingAction.settings,
      }, serializedCatalog)
    : null;
  const pendingAction = normalizedPendingAction
    ? withAgentMediaReferenceContext(
        normalizedPendingAction,
        tool.capability,
        typeof rawPendingAction?.referenceImageCount === "number"
          ? rawPendingAction.referenceImageCount
          : 0,
      )
    : null;
  const confirmedJobId = typeof stored.confirmedJobId === "string" &&
      /^[a-zA-Z0-9-]{8,100}$/.test(stored.confirmedJobId)
    ? stored.confirmedJobId
    : undefined;
  return {
    ...tool,
    ...(pendingAction ? { pendingAction: { ...pendingAction,
      ...(Array.isArray(rawPendingAction?.sourceAssetIds) ? { sourceAssetIds: rawPendingAction.sourceAssetIds.filter((id): id is string => typeof id === "string").slice(0, 10) } : {}),
    } } : {}),
    ...(confirmedJobId ? { confirmedJobId } : {}),
  };
}

export function normalizeAgentMediaAction(
  tool: AgentMediaTool,
  value: unknown,
  serializedCatalog?: string,
): AgentMediaAction | null {
  if (!tool.selectionConfirmed) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["prompt", "settings", "requiresReferenceImage"].includes(key))) return null;
  if (input.requiresReferenceImage !== undefined && typeof input.requiresReferenceImage !== "boolean") return null;
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < 2 || prompt.length > 40_000) return null;
  const requested = {
    ...tool.settings,
    ...(input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
      ? input.settings as MediaGenerationSettings
      : {}),
  };
  const settings = normalizeMediaGenerationSettings(tool.modelId, requested, serializedCatalog);
  return settings ? { prompt, settings,
    ...(typeof input.requiresReferenceImage === "boolean" ? { requiresReferenceImage: input.requiresReferenceImage } : {}),
  } : null;
}

export function mediaActionMissingReferenceMessage(
  capability: MediaModelKind,
  prompt: string,
  imageAssetCount: number,
  requiresReferenceImage?: boolean,
): string | null {
  if (capability !== "image" || imageAssetCount > 0) return null;
  const required = requiresReferenceImage ?? legacyPromptRequiresReferenceImage(prompt);
  return required ? MEDIA_REFERENCE_REQUIRED_MESSAGE : null;
}

/** Each deliverable owns its own card. Older single-card jobs remain readable. */
export function agentMediaToolsFromStored(value: unknown, catalog?: string): AgentMediaTool[] {
  let parsed = value;
  if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { return []; } }
  if (!parsed || typeof parsed !== "object") return [];
  const entries = (parsed as Record<string, unknown>).agentMediaTools;
  if (!Array.isArray(entries)) { const tool = agentMediaToolFromStored(parsed, catalog); return tool ? [tool] : []; }
  return entries.slice(0, 4).flatMap(entry => {
    const tool = agentMediaToolFromStored({ agentMediaTool: entry }, catalog);
    // Preserve old Seed Audio music card keys so existing confirmations stay idempotent.
    const legacySeedAudio = tool?.modelId === "doubao-audio-1.0" && tool.category === "voice" && entry?.proposalId === "music";
    return tool && (entry?.proposalId === tool.category || legacySeedAudio) ? [{ ...tool, proposalId: entry.proposalId,
      ...(entry.referenceFrom === "image" && tool.capability === "video" ? { referenceFrom: "image" as const } : {}) }] : [];
  });
}

export function storedMediaCards(tools: AgentMediaTool[]) {
  return tools.map(tool => ({ ...agentMediaToolEnvelope(tool, { pendingAction: tool.pendingAction,
    confirmedJobId: tool.confirmedJobId }).agentMediaTool, proposalId: tool.proposalId || tool.category,
    ...(tool.referenceFrom ? { referenceFrom: tool.referenceFrom } : {}) }));
}
