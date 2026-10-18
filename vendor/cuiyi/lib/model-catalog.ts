import { flovaMappingFor, flovaSupportsSettings, libTvMappingFor, FLOVA_SUNBURST_NAME } from "./media-provider-mapping.ts";

export type Capability =
  | "chat"
  | "copy"
  | "script"
  | "storyboard"
  | "image"
  | "video"
  | "audio"
  | "edit";

export type ModelKind = "text" | "image" | "video" | "audio";
export type MediaModelKind = "image" | "video" | "audio";
export type MediaModelCategory = "image" | "video" | "music" | "voice";
export type MediaGenerationSettingKey =
  | "mode"
  | "ratio"
  | "quality"
  | "resolution"
  | "count"
  | "duration"
  | "sound"
  | "language"
  | "format"
  | "speed"
  | "instrumental";
export type MediaGenerationSettingValue = string | number;
export type MediaGenerationSettings = Partial<Record<MediaGenerationSettingKey, MediaGenerationSettingValue>>;
export type MediaGenerationSettingDefinition = {
  key: MediaGenerationSettingKey;
  label: string;
  defaultValue: MediaGenerationSettingValue;
  options: Array<{ value: MediaGenerationSettingValue; label: string }>;
};
export type PublicTextModelId =
  | "glm-5.3-flash"
  | "glm-5.3"
  | "kimi-k3"
  | "kimi-k2.8-preview"
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "seed-2.1-pro"
  | "gpt-6.1-sol"
  | "claude-opus-5.5"
  | "gemini-3.8-flash"
  | "grok-4-1-fast-reasoning"
  | "grok-4.3"
  | "gpt-6-luna"
  | "ko-gpt-6-luna"
  | "jk-gpt-6-sol"
  | "jk-gpt-6-luna"
  | "jk-gemini-3.8-flash"
  | "jk-claude-opus-5.5"
  | "jk-claude-sonnet-5"
  | "jk-gpt-6-astra";

export type ReviewModelId =
  | "kimi-k3"
  | "glm-5.3"
  | "gpt-6.1-sol"
  | "claude-opus-5.5"
  | "gemini-3.8-flash"
  | "grok-4-1-fast-reasoning"
  | "grok-4.3"
  | "jk-gpt-6-sol"
  | "jk-gemini-3.8-flash"
  | "jk-claude-opus-5.5"
  | "jk-gpt-6-astra";

export type ReviewAction = "review" | "polish";
export type ReviewSubmissionAction = "review";

export type ChatMode = "general" | "reasoning";
export type AgentMode = "auto" | "chat" | "work";
export type TextIntent = "copy" | "story" | "idea" | "creative" | "poster";

export type PublicModel = {
  id: string;
  label: string;
  kind: ModelKind;
  description: string;
  speed: "快" | "标准" | "较慢";
  cost: "低" | "中" | "高";
  recommended?: boolean;
  inputModalities?: Array<"text" | "image">;
};

export type MediaModelCatalogEntry = {
  id: string;
  label: string;
  kind: MediaModelKind;
  category: MediaModelCategory;
  description: string;
  purpose: "image" | "video" | "music" | "sound" | "voiceover";
  purposeLabel: string;
  enabled: boolean;
  hidden?: boolean;
  available: boolean;
  order: number;
  generationSettings?: MediaGenerationSettingDefinition[];
  execution: {
    channel: "libtv" | "flova-ai";
    modelKey: string;
  };
};

export type PublicMediaModel = Omit<MediaModelCatalogEntry, "enabled" | "hidden" | "execution">;

export const textModels: PublicModel[] = [
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    kind: "text",
    description: "默认多模态 Chat / Work 模型，适合问答、创作与文件理解",
    speed: "快",
    cost: "低",
    recommended: true,
    inputModalities: ["text", "image"],
  },
  {
    id: "glm-5.3",
    label: "GLM 5.3",
    kind: "text",
    description: "高质量 Chat / Work 模型，也可用于独立审核",
    speed: "标准",
    cost: "中",
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    kind: "text",
    description: "适合聊天、文案、故事与创意",
    speed: "快",
    cost: "中",
    inputModalities: ["text", "image"],
  },
  // Keep the stored ID so existing conversations and employee preferences survive the upgrade.
  { id: "kimi-k2.8-preview", label: "Kimi K2.8 Preview", kind: "text", description: "Kimi Code 创作、长文与图片理解模型", speed: "快", cost: "中", inputModalities: ["text", "image"] },
  { id: "deepseek-v4-flash", label: "DeepSeek V4.1 Flash", kind: "text", description: "快速创作与原生图片理解", speed: "快", cost: "中", inputModalities: ["text", "image"] },
  {
    id: "seed-2.1-pro",
    label: "Seed 2.1 Pro",
    kind: "text",
    description: "长篇文字、多模态理解与创意写作模型",
    speed: "标准",
    cost: "高",
    inputModalities: ["text", "image"],
  },
  { id: "claude-opus-5.5", label: "Claude Opus 5.5", kind: "text", description: "复杂分析、高质量创作与图片理解", speed: "较慢", cost: "高", inputModalities: ["text", "image"] },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", kind: "text", description: "复杂推理、正式交付与图片理解", speed: "标准", cost: "高", inputModalities: ["text", "image"] },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", kind: "text", description: "快速问答、创作与图片理解", speed: "快", cost: "中", inputModalities: ["text", "image"] },
  { id: "gpt-6-luna", label: "GPT-6 Luna", kind: "text", description: "轻量问答、长文创作与图片理解", speed: "快", cost: "低", inputModalities: ["text", "image"] },
  { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning", kind: "text", description: "快速推理、创作与图片理解", speed: "快", cost: "低", inputModalities: ["text", "image"] },
  { id: "grok-4.3", label: "Grok 4.3", kind: "text", description: "复杂推理、创作与图片理解", speed: "标准", cost: "中", inputModalities: ["text", "image"] },
];

export const reviewModels: Array<PublicModel & { id: ReviewModelId }> = [
  { id: "kimi-k3", label: "Kimi K3", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "快", cost: "中" },
  { id: "glm-5.3", label: "GLM 5.3", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "标准", cost: "中" },
  { id: "claude-opus-5.5", label: "Claude Opus 5.5", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "较慢", cost: "高" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "标准", cost: "高" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "快", cost: "中" },
  { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "快", cost: "低" },
  { id: "grok-4.3", label: "Grok 4.3", kind: "text", description: "独立审核，只审不改，可用于终审", speed: "标准", cost: "中" },
];

export const chatModes: { id: ChatMode; label: string; description: string }[] = [
  { id: "general", label: "通用聊天", description: "直接、自然地完成日常创作" },
  { id: "reasoning", label: "推理聊天", description: "用于复杂结构、逻辑与创意推演" },
];

const textExecutionRoutes: Record<PublicTextModelId, string> = {
  "kimi-k2.8-preview": "kimi-k2.8-preview",
  "gemini-3.8-flash": "gemini-3.8-flash",
  "grok-4-1-fast-reasoning": "grok-4-1-fast-reasoning",
  "grok-4.3": "grok-4.3",
  "gpt-6-luna": "gpt-6-luna",
  "claude-opus-5.5": "claude-opus-5.5",
  "gpt-6.1-sol": "gpt-6.1-sol",
  "glm-5.3-flash": "glm-5.3-flash",
  "glm-5.3": "glm-5.3",
  "kimi-k3": "kimi",
  "deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek-v4-pro",
  "seed-2.1-pro": "doubao-2.1",
  "ko-gpt-6-luna": "ko-gpt-6-luna",
  "jk-gpt-6-sol": "jk-gpt-6-sol",
  "jk-gpt-6-luna": "jk-gpt-6-luna",
  "jk-gemini-3.8-flash": "jk-gemini-3.8-flash",
  "jk-claude-opus-5.5": "jk-claude-opus-5.5",
  "jk-claude-sonnet-5": "jk-claude-sonnet-5",
  "jk-gpt-6-astra": "jk-gpt-6-astra",
};

const reviewExecutionRoutes: Record<ReviewModelId, string> = {
  "gemini-3.8-flash": "gemini-3.8-flash",
  "grok-4-1-fast-reasoning": "grok-4-1-fast-reasoning",
  "grok-4.3": "grok-4.3",
  "claude-opus-5.5": "claude-opus-5.5",
  "gpt-6.1-sol": "gpt-6.1-sol",
  "kimi-k3": "kimi",
  "glm-5.3": "glm-5.3",
  "jk-gpt-6-sol": "jk-gpt-6-sol",
  "jk-gemini-3.8-flash": "jk-gemini-3.8-flash",
  "jk-claude-opus-5.5": "jk-claude-opus-5.5",
  "jk-gpt-6-astra": "jk-gpt-6-astra",
};

export function isPublicTextModelId(value: unknown): value is PublicTextModelId {
  // Execution routes also retain hidden models for historical jobs.
  return typeof value === "string" && textModels.some((model) => model.id === value);
}

export function isReviewModelId(value: unknown): value is ReviewModelId {
  return typeof value === "string" && reviewModels.some((model) => model.id === value);
}

export function isReviewAction(value: unknown): value is ReviewAction {
  return value === "review" || value === "polish";
}

export function isReviewSubmissionAction(value: unknown): value is ReviewSubmissionAction {
  return value === "review";
}

export function isTextModelAvailable(modelId: PublicTextModelId, env?: { KIMI_API_KEY?: string; GLM_API_KEY?: string; DEEPSEEK_API_KEY?: string; DOUBAO_API_KEY?: string; OPENAI_API_KEY?: string; GEMINI_API_KEY?: string; JIEKOU_API_KEY?: string }) {
  void env;
  return isPublicTextModelId(modelId);
}

export function isChatMode(value: unknown): value is ChatMode {
  return value === "general" || value === "reasoning";
}

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "auto" || value === "chat" || value === "work";
}

export function isTextIntent(value: unknown): value is TextIntent {
  return value === "copy" || value === "story" || value === "idea" ||
    value === "creative" || value === "poster";
}

export function defaultTextIntentForCapability(capability: string): TextIntent {
  if (capability === "copy") return "copy";
  if (capability === "script") return "story";
  if (capability === "storyboard") return "creative";
  return "idea";
}

export function resolveTextModel(modelId: PublicTextModelId) {
  return textExecutionRoutes[modelId];
}

export function textModelSupportsDirectImageInput(modelId: unknown) {
  const internalId = String(modelId || "");
  // Historical jobs keep their original input contract after catalog removal.
  if (internalId === "jk-gpt-6-astra") return true;
  const publicId = internalId === "kimi"
    ? "kimi-k3"
    : internalId === "doubao-2.1"
      ? "seed-2.1-pro"
    : internalId === "glm-5.3-flash" || isPublicTextModelId(internalId)
      ? internalId
      : null;
  if (!publicId) return false;
  return Boolean(textModels.find((model) => model.id === publicId)?.inputModalities?.includes("image"));
}

export function resolveReviewModel(modelId: ReviewModelId) {
  return reviewExecutionRoutes[modelId];
}

export function publicReviewModelIdForInternal(modelId: string): ReviewModelId | null {
  if (modelId === "glm-5.2" || modelId === "glm-5.3") return "glm-5.3";
  if (modelId === "jk-gpt-5.6-sol") return "jk-gpt-6-sol";
  if (modelId === "jk-claude-opus-5") return "jk-claude-opus-5.5";
  return (Object.entries(reviewExecutionRoutes).find(([, internal]) => internal === modelId)?.[0]
    || null) as ReviewModelId | null;
}

export function publicTextModelIdForInternal(modelId: string): PublicTextModelId | null {
  // Keep historical provenance readable without admitting retired IDs for new work.
  if (isPublicTextModelId(modelId) || (modelId.startsWith("jk-") && Object.hasOwn(textExecutionRoutes, modelId))) {
    return modelId as PublicTextModelId;
  }
  const upgraded = {
    "gpt-5.6-sol": "jk-gpt-6-sol",
    "gpt-5.6-luna": "jk-gpt-6-luna",
    "ko-gpt-5.6-luna": "jk-gpt-6-luna",
    "ko-gpt-6-luna": "jk-gpt-6-luna",
    "jk-gpt-5.6-sol": "jk-gpt-6-sol",
    "jk-gpt-5.6-luna": "jk-gpt-6-luna",
    "jk-claude-opus-5": "jk-claude-opus-5.5",
  } as const;
  if (modelId in upgraded) return upgraded[modelId as keyof typeof upgraded];
  if (modelId === "kimi") return "kimi-k3";
  if (modelId === "glm-5.2" || modelId === "glm-5.3-flash") {
    return "glm-5.3-flash";
  }
  if (modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro") return modelId;
  if (modelId === "doubao-2.1") return "seed-2.1-pro";
  return null;
}

const videoModeLabels: Record<string, string> = {
  auto: "自动识别",
  text2video: "文生视频",
  singleImage2video: "图生视频",
  frames2video: "首尾帧",
  image2video: "图片参考",
  mixed2video: "全能参考",
  audio2video: "音频生视频",
};

function videoModeSetting(modes: string[]): MediaGenerationSettingDefinition {
  return {
    key: "mode",
    label: "制作方式",
    defaultValue: "auto",
    options: ["auto", ...modes].map((value) => ({ value, label: videoModeLabels[value] })),
  };
}

function videoRatioSetting(values: string[], defaultValue = "16:9"): MediaGenerationSettingDefinition {
  return {
    key: "ratio",
    label: "画面比例",
    defaultValue,
    options: values.map((value) => ({ value, label: value === "adaptive" ? "自适应" : value })),
  };
}

function videoResolutionSetting(values: string[], defaultValue: string): MediaGenerationSettingDefinition {
  return {
    key: "resolution",
    label: "清晰度",
    defaultValue,
    options: values.map((value) => ({ value, label: value.toUpperCase() })),
  };
}

function videoDurationSetting(values: number[], defaultValue = 5): MediaGenerationSettingDefinition {
  return {
    key: "duration",
    label: "视频时长",
    defaultValue,
    options: values.map((value) => ({ value, label: `${value}秒` })),
  };
}

function videoSoundSetting(): MediaGenerationSettingDefinition {
  return {
    key: "sound",
    label: "声音 / 音效",
    defaultValue: "on",
    options: [
      { value: "on", label: "生成声音" },
      { value: "off", label: "无声视频" },
    ],
  };
}

function videoCountSetting(): MediaGenerationSettingDefinition {
  return {
    key: "count",
    label: "生成数量",
    defaultValue: 1,
    options: [1, 2, 4].map((value) => ({ value, label: `${value}个` })),
  };
}

const defaultMediaModelCatalog: MediaModelCatalogEntry[] = [
  {
    id: "gpt-image-2", label: "GPT Image 2", kind: "image", category: "image",
    description: "高质量商品图与文字控制", purpose: "image", purposeLabel: "图片制作",
    enabled: true, hidden: true, available: true, order: 10,
    generationSettings: [
      {
        key: "quality", label: "画质", defaultValue: "medium",
        options: [
          { value: "low", label: "低画质" },
          { value: "medium", label: "中画质" },
        ],
      },
      {
        key: "resolution", label: "分辨率", defaultValue: "2K",
        options: [
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ],
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["1:1", "1:2", "2:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21"]
          .map((value) => ({ value, label: value })),
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "libtv", modelKey: "lib-image-2" },
  },
  {
    id: "image-2.5-sunburst", label: "Image 2.5 Sunburst", kind: "image", category: "image",
    description: "精准生成与编辑，复杂指令与文字排版", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 15.5,
    generationSettings: [
      {
        key: "resolution", label: "清晰度", defaultValue: "2K",
        options: [
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ],
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: [
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
        ],
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "flova-ai", modelKey: FLOVA_SUNBURST_NAME },
  },
  {
    id: "lib-image-2.5-pro", label: "Lib Image 2.5 Pro", kind: "image", category: "image",
    description: "精准生成与编辑，复杂指令与文字排版", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 15,
    generationSettings: [
      {
        key: "quality", label: "画质", defaultValue: "medium",
        options: [
          { value: "low", label: "低画质" },
          { value: "medium", label: "中画质" },
          { value: "high", label: "高画质" },
          { value: "xhigh", label: "超高画质" },
          { value: "max", label: "Max画质" },
        ],
      },
      {
        key: "resolution", label: "清晰度", defaultValue: "2K",
        options: [
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ],
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: [
          { value: "1:1", label: "1:1" },
          { value: "1:2", label: "1:2" },
          { value: "2:1", label: "2:1" },
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
          { value: "3:2", label: "3:2" },
          { value: "2:3", label: "2:3" },
          { value: "5:4", label: "5:4" },
          { value: "4:5", label: "4:5" },
          { value: "21:9", label: "21:9" },
          { value: "9:21", label: "9:21" },
        ],
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "libtv", modelKey: "lib-image-2.5-s" },
  },
  {
    id: "qwen-image-3.0", label: "Qwen Image 3.0", kind: "image", category: "image",
    description: "复杂版面与精准文字的图片生成及编辑", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 16,
    generationSettings: [
      {
        key: "quality", label: "画质", defaultValue: "std",
        options: [
          { value: "std", label: "标准" },
          { value: "pro", label: "Pro" },
        ],
      },
      {
        key: "resolution", label: "清晰度", defaultValue: "2K",
        options: [
          { value: "1K", label: "1K" },
          { value: "2K", label: "2K" },
        ],
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: [
          { value: "auto", label: "自适应" },
          { value: "1:1", label: "1:1" },
          { value: "9:16", label: "9:16" },
          { value: "16:9", label: "16:9" },
          { value: "3:4", label: "3:4" },
          { value: "4:3", label: "4:3" },
          { value: "3:2", label: "3:2" },
          { value: "2:3", label: "2:3" },
        ],
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "libtv", modelKey: "qwen-image-3" },
  },
  {
    id: "nano-banana-pro", label: "Nano Banana Pro", kind: "image", category: "image",
    description: "参考图编辑与主体一致性生成", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 20,
    generationSettings: [
      {
        key: "quality", label: "分辨率", defaultValue: "2K",
        options: ["1K", "2K", "4K"].map((value) => ({ value, label: value })),
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "4:5", "5:4", "21:9"]
          .map((value) => ({ value, label: value === "auto" ? "自适应" : value })),
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "libtv", modelKey: "nebula-ultra" },
  },
  {
    id: "seedream-5.0-pro", label: "Seedream 5.0 Pro", kind: "image", category: "image",
    description: "高质量图像生成与编辑", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 30,
    generationSettings: [
      {
        // LibTV 的 Seedream 5.0 Pro schema 把 1K/2K 字段命名为 quality。
        // 这里必须使用真实 CLI 字段名；resolution 会在任务开始前被 LibTV 拒绝。
        key: "quality", label: "分辨率", defaultValue: "2K",
        options: ["1K", "2K"].map((value) => ({ value, label: value })),
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"]
          .map((value) => ({ value, label: value })),
      },
      {
        key: "count", label: "生成数量", defaultValue: 1,
        options: [1, 2, 4].map((value) => ({ value, label: `${value}张` })),
      },
    ],
    execution: { channel: "libtv", modelKey: "doubao-seedream-5-0-pro" },
  },
  {
    id: "midjourney-v8.2", label: "MidJourney V8.2", kind: "image", category: "image",
    description: "新一代风格化主视觉与创意方案", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 40,
    generationSettings: [
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"]
          .map((value) => ({ value, label: value })),
      },
    ],
    execution: { channel: "libtv", modelKey: "mj-v8.2" },
  },
  {
    id: "midjourney-v7", label: "MidJourney V7", kind: "image", category: "image",
    description: "经典风格化主视觉与创意方案", purpose: "image", purposeLabel: "图片制作",
    enabled: true, available: true, order: 50,
    generationSettings: [
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"]
          .map((value) => ({ value, label: value })),
      },
    ],
    execution: { channel: "libtv", modelKey: "mj-v7" },
  },
  {
    id: "seedance-2.0-mini", label: "Seedance 2.0 Mini", kind: "video", category: "video",
    description: "高性价比短视频生成", purpose: "video", purposeLabel: "视频制作",
    enabled: true, available: true, order: 10,
    generationSettings: [
      videoModeSetting(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video", "audio2video"]),
      videoResolutionSetting(["480p", "720p"], "720p"),
      videoRatioSetting(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]),
      videoDurationSetting([4, 5, 6, 8, 10, 12, 15]),
      videoSoundSetting(),
      videoCountSetting(),
    ],
    execution: { channel: "libtv", modelKey: "star-video2-mini" },
  },
  {
    id: "seedance-2.0", label: "Seedance 2.0", kind: "video", category: "video",
    description: "稳定的图生视频与商品镜头", purpose: "video", purposeLabel: "视频制作",
    enabled: true, available: true, order: 20,
    generationSettings: [
      videoModeSetting(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video", "audio2video"]),
      videoResolutionSetting(["480p", "720p", "1080p"], "720p"),
      videoRatioSetting(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]),
      videoDurationSetting([4, 5, 6, 8, 10, 12, 15]),
      videoSoundSetting(),
      videoCountSetting(),
    ],
    execution: { channel: "libtv", modelKey: "star-video2" },
  },
  {
    id: "seedance-2.5", label: "Seedance 2.5", kind: "video", category: "video",
    description: "高质量镜头运动与一致性", purpose: "video", purposeLabel: "视频制作",
    enabled: true, available: true, order: 30,
    generationSettings: [
      videoModeSetting(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video", "audio2video"]),
      videoResolutionSetting(["480p", "720p", "1080p"], "720p"),
      videoRatioSetting(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], "adaptive"),
      videoDurationSetting([4, 5, 6, 8, 10, 12, 15, 20, 25, 30]),
      videoSoundSetting(),
      videoCountSetting(),
    ],
    execution: { channel: "libtv", modelKey: "star-video2.5" },
  },
  {
    id: "kling-o3", label: "Kling O3", kind: "video", category: "video",
    description: "复杂动作与商业画面", purpose: "video", purposeLabel: "视频制作",
    enabled: true, available: true, order: 40,
    generationSettings: [
      videoModeSetting(["text2video", "mixed2video", "singleImage2video", "frames2video"]),
      {
        key: "quality", label: "清晰度", defaultValue: "low",
        options: [
          { value: "low", label: "标准" },
          { value: "high", label: "高品质" },
        ],
      },
      videoRatioSetting(["16:9", "1:1", "9:16"]),
      videoDurationSetting([3, 5, 6, 8, 10, 12, 15]),
      videoSoundSetting(),
    ],
    execution: { channel: "libtv", modelKey: "kling-v3-omni" },
  },
  {
    id: "minimax-h3", label: "MiniMax H3", kind: "video", category: "video",
    description: "人物与生活化场景", purpose: "video", purposeLabel: "视频制作",
    enabled: true, available: true, order: 50,
    generationSettings: [
      videoModeSetting(["text2video", "mixed2video", "singleImage2video", "frames2video", "image2video"]),
      {
        key: "resolution", label: "分辨率", defaultValue: "2K",
        options: ["768P", "2K"].map((value) => ({ value, label: value })),
      },
      {
        key: "ratio", label: "尺寸比例", defaultValue: "16:9",
        options: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
          .map((value) => ({ value, label: value })),
      },
      {
        key: "duration", label: "视频时长", defaultValue: 5,
        options: Array.from({ length: 11 }, (_, index) => index + 5)
          .map((value) => ({ value, label: `${value}秒` })),
      },
      videoCountSetting(),
    ],
    execution: { channel: "libtv", modelKey: "MiniMax-Hailuo-H3" },
  },
  {
    id: "suno", label: "Suno", kind: "audio", category: "music",
    description: "歌曲、配乐与音乐制作", purpose: "music", purposeLabel: "音乐制作",
    enabled: true, available: true, order: 30,
    generationSettings: [
      {
        key: "duration", label: "音乐时长", defaultValue: 60_000,
        options: [30_000, 60_000, 120_000].map((value) => ({
          value,
          label: value === 30_000 ? "30秒" : value === 60_000 ? "1分钟" : "2分钟",
        })),
      },
      {
        key: "instrumental", label: "人声", defaultValue: 0,
        options: [
          { value: 0, label: "允许人声" },
          { value: 1, label: "纯音乐" },
        ],
      },
    ],
    execution: { channel: "flova-ai", modelKey: "S Music" },
  },
  {
    id: "eleven-music", label: "Eleven Music", kind: "audio", category: "music",
    description: "歌曲、配乐与音乐制作", purpose: "music", purposeLabel: "音乐制作",
    enabled: true, available: true, order: 10,
    generationSettings: [
      {
        key: "duration", label: "音乐时长", defaultValue: 30_000,
        options: [
          { value: 30_000, label: "30秒" },
          { value: 60_000, label: "1分钟" },
          { value: 120_000, label: "2分钟" },
          { value: 180_000, label: "3分钟" },
          { value: 240_000, label: "4分钟" },
        ],
      },
    ],
    execution: { channel: "libtv", modelKey: "vocal-music" },
  },
  {
    id: "mureka-8", label: "Mureka 8", kind: "audio", category: "music",
    description: "纯音乐、歌曲与多风格音乐制作", purpose: "music", purposeLabel: "音乐制作",
    enabled: true, available: true, order: 20,
    generationSettings: [
      {
        key: "mode", label: "制作方式", defaultValue: "auto",
        options: [
          { value: "auto", label: "自动识别" },
          { value: "text2audio", label: "描述生成音乐" },
          { value: "lyrics2audio", label: "歌词生成歌曲" },
        ],
      },
      {
        key: "instrumental", label: "人声", defaultValue: 1,
        options: [
          { value: 1, label: "纯音乐" },
          { value: 0, label: "允许人声" },
        ],
      },
    ],
    execution: { channel: "libtv", modelKey: "mureka-8" },
  },
  {
    id: "doubao-audio-1.0", label: "Seed Audio 1.0", kind: "audio", category: "voice",
    description: "音乐、音效、环境声与对白一体化生成", purpose: "sound", purposeLabel: "音效制作",
    enabled: true, available: true, order: 40,
    generationSettings: [
      {
        key: "mode", label: "生成类型", defaultValue: "sound-effect",
        options: [
          { value: "sound-effect", label: "音效" },
          { value: "scene-audio", label: "完整场景音频" },
          { value: "music", label: "音乐" },
        ],
      },
      {
        key: "duration", label: "音频时长", defaultValue: 10_000,
        options: [5_000, 10_000, 15_000, 30_000, 60_000, 120_000].map((value) => ({
          value,
          label: value < 60_000 ? `${value / 1_000}秒` : `${value / 60_000}分钟`,
        })),
      },
    ],
    execution: { channel: "flova-ai", modelKey: "Seed-Audio 1.0" },
  },
  {
    id: "minimax-audio", label: "MiniMax 2.8", kind: "audio", category: "voice",
    description: "自然人声与旁白制作", purpose: "voiceover", purposeLabel: "旁白制作",
    enabled: true, available: true, order: 10,
    generationSettings: [
      {
        key: "speed", label: "语速", defaultValue: 1,
        options: [
          { value: 0.75, label: "较慢" },
          { value: 1, label: "正常" },
          { value: 1.25, label: "较快" },
        ],
      },
    ],
    execution: { channel: "libtv", modelKey: "speech-2.8-hd" },
  },
  {
    id: "doubao-voice-2.0", label: "Doubao 2.0", kind: "audio", category: "voice",
    description: "自然中文旁白、口播与情绪化配音", purpose: "voiceover", purposeLabel: "旁白制作",
    enabled: true, available: true, order: 20,
    generationSettings: [
      {
        key: "language", label: "语种", defaultValue: "zh",
        options: [
          { value: "zh", label: "中文" },
          { value: "en", label: "英文" },
        ],
      },
      {
        key: "format", label: "输出格式", defaultValue: "mp3",
        options: [
          { value: "mp3", label: "MP3" },
          { value: "wav", label: "WAV" },
          { value: "ogg_opus", label: "OGG Opus" },
        ],
      },
      {
        key: "speed", label: "语速", defaultValue: 1,
        options: [
          { value: 0.75, label: "较慢" },
          { value: 1, label: "正常" },
          { value: 1.25, label: "较快" },
        ],
      },
    ],
    execution: { channel: "flova-ai", modelKey: "Doubao TTS 2.0" },
  },
];

const kinds = new Set<MediaModelKind>(["image", "video", "audio"]);
const categories = new Set<MediaModelCategory>(["image", "video", "music", "voice"]);
const purposes = new Set(["image", "video", "music", "sound", "voiceover"]);
const channels = new Set(["libtv", "flova-ai"]);
const generationSettingKeys = new Set<MediaGenerationSettingKey>([
  "mode", "ratio", "quality", "resolution", "count", "duration", "sound", "language", "format", "speed", "instrumental",
]);
const modelIdPattern = /^[a-z0-9][a-z0-9._-]{1,79}$/;

function validGenerationSettings(value: unknown): value is MediaGenerationSettingDefinition[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > generationSettingKeys.size) return false;
  const seen = new Set<string>();
  return value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const field = item as Partial<MediaGenerationSettingDefinition>;
    if (typeof field.key !== "string" || !generationSettingKeys.has(field.key as MediaGenerationSettingKey) || seen.has(field.key)) return false;
    seen.add(field.key);
    if (typeof field.label !== "string" || !field.label.trim() || field.label.length > 40) return false;
    if ((typeof field.defaultValue !== "string" && typeof field.defaultValue !== "number") || !Array.isArray(field.options) || !field.options.length || field.options.length > 20) return false;
    return field.options.every((option) => Boolean(option) && typeof option === "object" && !Array.isArray(option) &&
      (typeof option.value === "string" || typeof option.value === "number") &&
      typeof option.label === "string" && option.label.trim().length > 0 && option.label.length <= 40) &&
      field.options.some((option) => option.value === field.defaultValue);
  });
}

function validCatalogEntry(value: unknown): value is MediaModelCatalogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<MediaModelCatalogEntry>;
  const execution = entry.execution as Partial<MediaModelCatalogEntry["execution"]> | undefined;
  return typeof entry.id === "string" && modelIdPattern.test(entry.id) &&
    typeof entry.label === "string" && entry.label.trim().length > 0 && entry.label.length <= 80 &&
    typeof entry.description === "string" && entry.description.length <= 220 &&
    typeof entry.kind === "string" && kinds.has(entry.kind as MediaModelKind) &&
    typeof entry.category === "string" && categories.has(entry.category as MediaModelCategory) &&
    ((entry.kind === "image" || entry.kind === "video") && entry.category === entry.kind ||
      entry.kind === "audio" && (entry.category === "music" || entry.category === "voice")) &&
    typeof entry.purpose === "string" && purposes.has(entry.purpose) &&
    typeof entry.purposeLabel === "string" && entry.purposeLabel.trim().length > 0 && entry.purposeLabel.length <= 40 &&
    typeof entry.enabled === "boolean" && typeof entry.available === "boolean" &&
    (entry.hidden === undefined || typeof entry.hidden === "boolean") &&
    Number.isSafeInteger(entry.order) && Number(entry.order) >= 0 && Number(entry.order) <= 10_000 &&
    validGenerationSettings(entry.generationSettings) &&
    Boolean(execution) && typeof execution?.channel === "string" && channels.has(execution.channel) &&
    typeof execution?.modelKey === "string" && execution.modelKey.trim().length > 0 && execution.modelKey.length <= 120;
}

function parseOverride(serialized?: string) {
  if (!serialized?.trim()) return null;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || !value.length || !value.every(validCatalogEntry)) return null;
    if (new Set(value.map((entry) => entry.id)).size !== value.length) return null;
    return value;
  } catch {
    return null;
  }
}

export function mediaModelCatalog(serializedOverride?: string) {
  const override = parseOverride(serializedOverride);
  return [...(override || defaultMediaModelCatalog)].map(model =>
    model.execution.channel === "flova-ai" && !flovaMappingFor(model)
      ? { ...model, available: false, description: "当前生成服务未提供此型号，等待对应模型接入" } : model
  ).sort((left, right) =>
    left.category.localeCompare(right.category) || left.order - right.order || left.id.localeCompare(right.id),
  );
}

export function findMediaModel(modelId: string, serializedOverride?: string) {
  const catalog = mediaModelCatalog(serializedOverride);
  const exact = catalog.find((model) => model.id === modelId);
  if (exact) return exact;
  const legacyAliases: Record<string, string> = {
    // 修复前的任务使用 mj；继续映射到 V8.2，避免历史记录或排队任务失效。
    mj: "midjourney-v8.2",
    // 旧目录把 Seed Audio 错分为普通 TTS；现在映射到正确的综合音频模型。
    "seed-audio-1.0": "doubao-audio-1.0",
    "doubao-voice": "doubao-voice-2.0",
  };
  const replacementId = legacyAliases[modelId];
  if (replacementId) return catalog.find((model) => model.id === replacementId);
  return undefined;
}

const fixedFourImageMidJourneyModelIds = new Set([
  "mj",
  "midjourney-v8.2",
  "midjourney-v7",
]);

export function isFixedFourImageMidJourneyModel(modelId: string) {
  return fixedFourImageMidJourneyModelIds.has(modelId);
}

/**
 * Resolve the number of staged files an image/video job must publish.
 *
 * Generation settings are persisted with the job, so completion validates the
 * stored request instead of accepting however many files a Runner happens to
 * return. MidJourney is the one deliberate exception to the generic catalog
 * settings: both supported nodes always return four images.
 */
export function expectedMediaResultCount(
  modelId: string,
  generationSettings: unknown,
  serializedOverride?: string,
) {
  if (isFixedFourImageMidJourneyModel(modelId)) return 4;

  const model = findMediaModel(modelId, serializedOverride);
  if (!model || (model.kind !== "image" && model.kind !== "video")) return null;
  const countDefinition = model.generationSettings?.find((field) => field.key === "count");
  if (!countDefinition) return 1;

  let settings = generationSettings;
  if (typeof settings === "string") {
    try {
      settings = JSON.parse(settings);
    } catch {
      return null;
    }
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const requested = (settings as Record<string, unknown>).count ?? countDefinition.defaultValue;
  if (!Number.isSafeInteger(requested) || Number(requested) < 1 || Number(requested) > 8) return null;
  if (!countDefinition.options.some((option) => option.value === requested)) return null;
  return Number(requested);
}

export function defaultMediaGenerationSettings(modelId: string, serializedOverride?: string): MediaGenerationSettings {
  const definitions = findMediaModel(modelId, serializedOverride)?.generationSettings || [];
  return Object.fromEntries(definitions.map((field) => [field.key, field.defaultValue])) as MediaGenerationSettings;
}

export function normalizeMediaGenerationSettings(
  modelId: string,
  value: unknown,
  serializedOverride?: string,
): MediaGenerationSettings | null {
  const model = findMediaModel(modelId, serializedOverride);
  if (!model) return null;
  const definitions = model.generationSettings || [];
  if (value === undefined || value === null) return defaultMediaGenerationSettings(modelId, serializedOverride);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = { ...(value as Record<string, unknown>) };
  const allowedKeys = new Set(definitions.map((field) => field.key));
  // 兼容修复前已经保存在浏览器草稿或历史任务里的 Seedream 参数。
  // 旧 UI 使用 resolution；真实 LibTV schema 使用 quality。
  if (
    modelId === "seedream-5.0-pro" &&
    allowedKeys.has("quality") &&
    !allowedKeys.has("resolution") &&
    Object.hasOwn(input, "resolution")
  ) {
    if (Object.hasOwn(input, "quality") && input.quality !== input.resolution) return null;
    input.quality ??= input.resolution;
    delete input.resolution;
  }
  if (Object.keys(input).some((key) => !allowedKeys.has(key as MediaGenerationSettingKey))) return null;
  const normalized: MediaGenerationSettings = {};
  for (const field of definitions) {
    const requested = input[field.key] ?? field.defaultValue;
    const option = field.options.find((candidate) => candidate.value === requested);
    if (!option) return null;
    normalized[field.key] = option.value;
  }
  return normalized;
}

export function publicMediaModels(serializedOverride?: string): PublicMediaModel[] {
  return mediaModelCatalog(serializedOverride)
    .filter((model) => model.enabled && !model.hidden)
    .map((model) => ({
      id: model.id,
      label: model.label,
      kind: model.kind,
      category: model.category,
      description: model.description,
      purpose: model.purpose,
      purposeLabel: model.purposeLabel,
      available: model.available,
      order: model.order,
      generationSettings: model.generationSettings?.map((field) => ({
        ...field,
        options: field.options.map((option) => ({ ...option })),
      })),
    }));
}

export const imageModels = publicMediaModels().filter((model) => model.kind === "image");
export const videoModels = publicMediaModels().filter((model) => model.kind === "video");
export const audioModels = publicMediaModels().filter((model) => model.kind === "audio");
export const allModels = [...textModels, ...imageModels, ...videoModels, ...audioModels];

export function findModel(modelId: string) {
  return allModels.find((model) => model.id === modelId);
}

export function isModelAllowed(capability: Capability, modelId: string, serializedOverride?: string, env?: { KIMI_API_KEY?: string; GLM_API_KEY?: string; DEEPSEEK_API_KEY?: string; DOUBAO_API_KEY?: string; OPENAI_API_KEY?: string }) {
  if (["chat", "copy", "script", "storyboard"].includes(capability)) {
    return isPublicTextModelId(modelId) && isTextModelAvailable(modelId, env);
  }
  if (capability === "edit") return modelId === "chatcut";
  const model = findMediaModel(modelId, serializedOverride);
  return Boolean(model?.enabled && model.available && model.kind === capability);
}

const handFocusedVideoPattern = /(?:手部|手腕|手指|手掌|手背|手镯|腕镯|佩戴|戴上|摘下|取放|拿取|交接|\bhand(?:s)?\b|\bwrist(?:s)?\b|\bfinger(?:s)?\b|\bbracelet\b|\bbangle\b)/i;

export function mediaModelTaskRestriction(
  capability: Capability,
  modelId: string,
  prompt: string,
  serializedOverride?: string,
) {
  if (capability !== "video" || !handFocusedVideoPattern.test(prompt)) return null;
  const model = findMediaModel(modelId, serializedOverride);
  const restricted = modelId === "seedance-2.0-mini" || /fast/i.test(`${modelId} ${model?.label || ""}`);
  return restricted
    ? "当前视频模型不适合手部、手腕或佩戴近景，请改用 Seedance 2.5、Seedance 2.0 或 MiniMax H3。系统不会自动换模型。"
    : null;
}

export function defaultModelFor(capability: Capability, serializedOverride?: string) {
  if (["chat", "copy", "script", "storyboard"].includes(capability)) return "glm-5.3-flash";
  if (capability === "edit") return "chatcut";
  return mediaModelCatalog(serializedOverride).find(
    (model) => model.kind === capability && model.enabled && !model.hidden && model.available,
  )?.id || null;
}

export function executionForMediaModel(modelId: string, serializedOverride?: string) {
  const model = findMediaModel(modelId, serializedOverride);
  return model?.enabled && model.available ? { ...model.execution } : null;
}

export function providerRoutesForMediaModel(modelId: string, serializedOverride?: string, settings?: unknown) {
  const model = findMediaModel(modelId, serializedOverride);
  if (!model?.enabled || !model.available) return [];
  if (
    model.execution.channel === "libtv" && flovaSupportsSettings(model, settings)
  ) {
    return ["libtv", "flova-ai"] as const;
  }
  if (model.execution.channel === "flova-ai" && !flovaSupportsSettings(model, settings)) return [];
  if (model.execution.channel === "flova-ai" && libTvMappingFor(model)) return ["flova-ai", "libtv"] as const;
  return [model.execution.channel] as const;
}

export function defaultChannelFor(capability: Capability, modelId?: string, serializedOverride?: string) {
  if (capability === "edit") return "chatcut";
  if (capability === "image" || capability === "video" || capability === "audio") {
    return modelId ? executionForMediaModel(modelId, serializedOverride)?.channel || null : null;
  }
  return null;
}

export function isChannelAllowed(capability: Capability, channelId: string | null) {
  if (capability === "edit") return channelId === "chatcut";
  if (capability === "image" || capability === "video") return channelId === "libtv";
  if (capability === "audio") return channelId === "libtv" || channelId === "flova-ai";
  return channelId === null;
}
