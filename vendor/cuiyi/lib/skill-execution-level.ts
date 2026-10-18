export const skillExecutionLevels = ["off", "low", "middle", "high", "max"] as const;

export type SkillExecutionLevel = (typeof skillExecutionLevels)[number];

const executionLevelSet = new Set<string>(skillExecutionLevels);

export function parseSkillExecutionLevel(value: unknown): SkillExecutionLevel | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return executionLevelSet.has(normalized) ? normalized as SkillExecutionLevel : null;
}

/** A missing per-use choice (including imported or legacy usage) defaults to Max. */
export function normalizeSkillExecutionLevel(value: unknown): SkillExecutionLevel {
  return parseSkillExecutionLevel(value) || "max";
}

export function skillExecutionLevelLabel(value: unknown) {
  const level = normalizeSkillExecutionLevel(value);
  return level === "off"
    ? "Off"
    : level === "low"
      ? "Low"
      : level === "middle"
        ? "Middle"
        : level === "high"
          ? "High"
          : "Max";
}

export function skillExecutionLevelInstruction(value: unknown) {
  const level = normalizeSkillExecutionLevel(value);
  if (level === "off") return "不加载此 Skill，也不应用其中任何规则。";
  if (level === "low") return "轻量应用：只执行最核心的硬性规则，不主动扩展次要方法。";
  if (level === "middle") return "标准应用：执行主要规则、步骤和输出结构。";
  if (level === "high") return "强化应用：完整执行规则，并在交付前进行一次一致性自检。";
  return "顶格应用：完整执行全部规则，优先解决规则冲突，并对事实、结构、调性和交付要求进行深度校验。";
}
