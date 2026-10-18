export const skillCategories = [
  "通用",
  "账号调性",
  "账号调性初设",
  "爆款文案",
  "运营模块",
  "导演执行",
  "生成器 Chat/Work",
  "审查 Review",
] as const;

export const GENERATOR_SKILL_MAX_INSTRUCTION_CHARACTERS = 8_000;
export const ACCOUNT_PROFILE_SKILL_MAX_INSTRUCTION_CHARACTERS = 96_000;

export function isAccountProfileSkillCategory(category: unknown) {
  return category === "账号调性" || category === "账号调性初设";
}

export function skillInstructionCharacterLimit(category: unknown) {
  return isAccountProfileSkillCategory(category)
    ? ACCOUNT_PROFILE_SKILL_MAX_INSTRUCTION_CHARACTERS
    : GENERATOR_SKILL_MAX_INSTRUCTION_CHARACTERS;
}
