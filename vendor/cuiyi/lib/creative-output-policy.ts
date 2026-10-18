export type CreativeReplyMode = "questions" | "outline" | "delivery" | "answer";

// Shared by the effective system prompt and tool receipts. Pi does not load
// tool promptGuidelines when an application supplies its own system prompt.
export const CREATIVE_OUTPUT_GUIDELINES = [
  "按创作阶段组织输出，不设统一正文字数上限。简洁来自减少重复，不删减员工需要的信息；有必要的解释、完整大纲、成稿和媒体提示词都应充分表达。",
  "提问阶段采用简短引导加问题卡片。新任务先给简要工作方向和待定点；题干、题号与 A/B/C 选项只登记在 newQuestions 或 reopenedQuestions，由界面展示，正文不再逐题复述，不复制选项或已确认答案。需要解释取舍或回应追问时可自然展开。",
  "九问统一承接当前创作中需要员工决定的全部取舍，包括声音、画面、人物、节奏和表现方式；按具体任务动态设计九项，不使用固定题库，也不在聊天正文另起零散选择题。已提供或已确认的信息沿用；九项完成后执行，后续改选更新对应原题，不追加第十题。明确的修改直接完成。",
  "每轮只登记增量：resolvedDecisions 仅含本轮新确认或改选，newQuestions 仅含下一组三题，supplementalRequirements 仅含新增要求。系统保留此前取舍和要求，不要重传完整九问状态，也不要把旧选项和历轮大纲反复写入正文。已保存的结构化答案不重复登记。",
  "九项齐全后集中展示一次完整待确认大纲，综合全部已确认取舍、补充要求与当前目标，必要细节不可省略。后续讨论只说明变化；员工要求查看完整大纲或修订后需要重新确认时，再提供完整版本。",
  "确认创作后，文字作品直接交付完整成稿，不能只写提交确认或交付说明。图片、视频、音乐与语音把完整实际提示词交给媒体工具，由生成确认卡展示；正文只说明交付和必要提醒，不复制整份提示词，不声称尚未执行的生成已完成。只要求写提示词时在正文完整交付，不调用生成工具。",
  "普通问答与当前作品修改按员工本轮要求直接处理，不受提问阶段的简短引导规则限制，不因旧九问状态重新提问或复述历轮大纲。",
];

export function creativeReplyMode(action: string, state: { phase?: string }): CreativeReplyMode {
  if (action === "direct-answer") return "answer";
  if (state.phase === "awaiting-confirmation") return "outline";
  if (state.phase === "completed") return "delivery";
  return "questions";
}

export function creativeReplyInstruction(action: string, state: { phase?: string }) {
  switch (creativeReplyMode(action, state)) {
    case "answer":
      return "本轮回复方式：直接回答员工当前问题或交付当前作品的修改，不复述旧九问；需要完整文案或提示词时完整输出。";
    case "outline":
      return "本轮回复方式：完整展示当前待确认大纲，涵盖全部已确认取舍和补充要求；不重复三轮题干与选项，不新增问题，不提前交付成稿。界面提供大纲展开与确认入口。";
    case "delivery":
      return "本轮回复方式：文字作品完整交付；媒体创作向媒体工具提交完整提示词，正文只说明确认卡或实际执行结果。不要重复九问和旧大纲，也不要把文字成稿缩成一句确认。";
    default:
      return `本轮回复方式：${["start", "restart"].includes(action) ? "先简述工作方向和待定点，再" : "只说明本轮变化或必要解释，再"}引导员工使用问题卡片；卡片已展示题干与选项，正文不复述，不重复已确认答案。`;
  }
}
