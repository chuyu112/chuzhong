// Actual effort levels, not compatibility aliases. In particular, Kimi and
// DeepSeek accept "medium" as an alias for high; GLM falls back to max.
// Sources checked 2026-10-18:
// https://www.kimi.com/code/docs/en/kimi-code/models
// https://github.com/zai-org/GLM-5/blob/main/README_zh.md
// https://api-docs.deepseek.com/api/create-response/
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://platform.claude.com/docs/en/build-with-claude/effort
// https://ai.google.dev/gemini-api/docs/thinking
// https://docs.volcengine.com/docs/ark/deep-thinking
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-3.html
export type TextReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";
type ReasoningProfile = { efforts: readonly TextReasoningEffort[]; fixed?: boolean };
const lowHighMax: ReasoningProfile = { efforts: ["low", "high", "max"] };
const full: ReasoningProfile = { efforts: ["low", "medium", "high", "xhigh", "max"] };
const mediumHigh: ReasoningProfile = { efforts: ["off", "low", "medium", "high"] };

export const textReasoningProfiles: Readonly<Record<string, ReasoningProfile>> = {
  "glm-5.3-flash": lowHighMax,
  "glm-5.3": lowHighMax,
  "kimi-k3": lowHighMax,
  kimi: lowHighMax,
  "kimi-k2.8-preview": lowHighMax,
  "deepseek-v4-flash": { efforts: ["off", "low", "high", "max"] },
  "seed-2.1-pro": mediumHigh,
  "doubao-2.1": mediumHigh,
  "claude-opus-5.5": full,
  "gpt-6.1-sol": full,
  "gpt-6-luna": { efforts: ["off", ...full.efforts] },
  "gemini-3.8-flash": { efforts: ["low", "medium", "high"] },
  "grok-4.3": mediumHigh,
  // This distinct reasoning model does not expose an effort/off parameter.
  // Do not silently substitute grok-4-1-fast-non-reasoning.
  "grok-4-1-fast-reasoning": { efforts: [], fixed: true },
};

export function selectTextReasoningEffort(efforts: readonly TextReasoningEffort[], mode: string): TextReasoningEffort | undefined {
  const order: TextReasoningEffort[] = mode === "reasoning"
    ? ["max", "xhigh", "high", "medium", "low", "off"]
    : ["medium", "low", "off"];
  return order.find(effort => efforts.includes(effort));
}

export function textReasoningEffort(modelId: string, mode: string, override?: string): TextReasoningEffort | undefined {
  const profile = textReasoningProfiles[modelId];
  if (!profile) return undefined;
  if (override) {
    const value = override === "none" ? "off" : override;
    if (!profile.efforts.includes(value as TextReasoningEffort)) throw new Error("当前模型不支持此推理强度");
    return value as TextReasoningEffort;
  }
  return selectTextReasoningEffort(profile.efforts, mode);
}

export function textReasoningControl(modelId: string) {
  const profile = textReasoningProfiles[modelId];
  const general = textReasoningEffort(modelId, "general");
  const reasoning = textReasoningEffort(modelId, "reasoning");
  const labels: Record<TextReasoningEffort, string> = { off: "关闭", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高" };
  return {
    fixed: profile?.fixed === true,
    generalLabel: general ? `通用 · ${labels[general]}` : "通用",
    reasoningLabel: reasoning ? `推理 · ${labels[reasoning]}` : "推理",
    generalTitle: general ? `通用：${general}` : "通用聊天",
    reasoningTitle: reasoning ? `推理：${reasoning}` : "推理聊天",
  };
}
