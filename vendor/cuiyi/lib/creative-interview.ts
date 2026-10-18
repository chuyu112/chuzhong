import { creativeReplyMode, type CreativeReplyMode } from "./creative-output-policy.ts";

export const CREATIVE_INTERVIEW_ROUNDS = 3;
export const CREATIVE_INTERVIEW_QUESTIONS_PER_ROUND = 3;
export const MINIMUM_CREATIVE_INTERVIEW_QUESTIONS =
  CREATIVE_INTERVIEW_ROUNDS * CREATIVE_INTERVIEW_QUESTIONS_PER_ROUND;

export type CreativeInterviewPhase =
  | "interviewing"
  | "awaiting-confirmation"
  | "completed";

export type CreativeKind =
  | "copy"
  | "story"
  | "script"
  | "storyboard"
  | "image"
  | "video"
  | "music"
  | "voice"
  | "creative";

export type CreativeInterviewState = {
  replyMode?: CreativeReplyMode;
  active: boolean;
  kind: CreativeKind;
  phase: CreativeInterviewPhase;
  asked: number;
  answered: number;
  confirmed: boolean;
  canGenerate: boolean;
  nextQuestionNumber: number;
  resolvedQuestionIds: number[];
  questions: CreativeQuestion[];
  decisions: CreativeDecision[];
  outlineRequirements: string[];
};

export type CreativeDecisionResolutionMode =
  | "explicit-answer"
  | "explicit-delegation"
  | "explicit-correction";

export type CreativeDecision = {
  questionId: number;
  summary: string;
  resolutionMode?: CreativeDecisionResolutionMode;
  evidence?: string;
};

export type CreativeQuestion = {
  questionId: number;
  summary: string;
  options?: string[];
};

export type CreativeInterviewOutput = {
  output: string;
  generationAllowed: boolean;
  state: CreativeInterviewState;
};

export type CreativeInterviewView = Pick<
  CreativeInterviewState,
  | "active"
  | "phase"
  | "asked"
  | "answered"
  | "confirmed"
  | "canGenerate"
  | "resolvedQuestionIds"
  | "replyMode"
> & {
  questions: CreativeQuestion[];
  decisions: Array<Pick<CreativeDecision, "questionId" | "summary">>;
};

export type CreativeWorkflowAction =
  | "direct-answer"
  | "start"
  | "continue"
  | "outline-ready"
  | "generate"
  | "send-review"
  | "revise"
  | "restart"
  | "autonomous-complete";

export type CreativeWorkflowReport = {
  action: CreativeWorkflowAction;
  mediaAction?: unknown;
  resolvedDecisions?: unknown;
  newQuestions?: unknown;
  autonomousDecisions?: unknown;
  autonomyEvidence?: unknown;
  supplementalRequirements?: unknown;
  reopenedQuestions?: unknown;
};

export type CreativeWorkflowReportContext = {
  employeeInput?: unknown;
  verificationRequired?: boolean;
  semanticReview?: {
    approvedDecisionIds: number[];
    autonomyAuthorized: boolean;
    generationAuthorized: boolean;
    reopenQuestionIds: number[];
  };
};

type CreativeJob = {
  textIntent?: unknown;
  creativeInterview?: unknown;
  generationSettings?: unknown;
  mediaTool?: unknown;
  outlineConfirmationReceipt?: { id: string; sourceJobId: string; outlineVersion: string; outline: string };
  interviewAnswerReceipt?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parsedRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizedIds(value: unknown, maximum = 1_000) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) =>
    Number.isInteger(id) && id > 0 && id <= maximum
  ))].sort((left, right) => left - right);
}

function normalizedDecisions(value: unknown, maximum = 1_000): CreativeDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions = new Map<number, CreativeDecision>();
  for (const item of value) {
    const record = asRecord(item);
    const questionId = Number(record?.questionId);
    const summary = typeof record?.summary === "string"
      ? record.summary.replaceAll(String.fromCharCode(0), "").trim().slice(0, 300)
      : "";
    if (!Number.isInteger(questionId) || questionId < 1 || questionId > maximum || summary.length < 2) continue;
    const resolutionMode = [
      "explicit-answer",
      "explicit-delegation",
      "explicit-correction",
    ].includes(String(record?.resolutionMode || ""))
      ? String(record?.resolutionMode) as CreativeDecisionResolutionMode
      : undefined;
    const evidence = typeof record?.evidence === "string"
      ? record.evidence.replaceAll(String.fromCharCode(0), "").trim().slice(0, 500)
      : "";
    decisions.set(questionId, {
      questionId,
      summary,
      ...(resolutionMode ? { resolutionMode } : {}),
      ...(evidence ? { evidence } : {}),
    });
  }
  return [...decisions.values()].sort((left, right) => left.questionId - right.questionId);
}

function normalizedQuestions(value: unknown, maximum = 1_000): CreativeQuestion[] {
  const records = new Map((Array.isArray(value) ? value : []).map((item) => {
    const record = asRecord(item);
    return [Number(record?.questionId), record];
  }));
  return normalizedDecisions(value, maximum).flatMap(({ questionId, summary }) => {
    const rawOptions = records.get(questionId)?.options;
    // Old saved interviews remain readable and can still be answered in prose.
    if (rawOptions === undefined) return [{ questionId, summary }];
    if (!Array.isArray(rawOptions) || rawOptions.length !== 3 || rawOptions.some((item) => typeof item !== "string")) return [];
    const options = rawOptions.map((item) => item.replaceAll(String.fromCharCode(0), "").trim().slice(0, 200));
    if (options.some((item) => !item) || new Set(options.map((item) => item.normalize("NFKC").toLowerCase())).size !== 3) return [];
    return [{ questionId, summary, options }];
  });
}

function normalizedStrings(value: unknown, maximumItems = 20, maximumLength = 500) {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item || "")
      .replaceAll(String.fromCharCode(0), "")
      .trim()
      .slice(0, maximumLength);
    const signature = text.normalize("NFKC").toLowerCase();
    if (text.length < 2 || seen.has(signature)) continue;
    seen.add(signature);
    output.push(text);
    if (output.length >= maximumItems) break;
  }
  return output;
}

function normalizedResolvedDecisions(
  value: unknown,
  maximum: number,
  employeeInput: string,
) {
  const submittedCount = Array.isArray(value) ? value.length : 0;
  const decisions = normalizedDecisions(value, maximum).filter((decision) => {
    if (!decision.resolutionMode || !decision.evidence) return false;
    if (!employeeInput || !employeeInput.includes(decision.evidence)) return false;
    return true;
  });
  return {
    decisions,
    hasInvalid: submittedCount !== decisions.length,
  };
}

function inactiveState(): CreativeInterviewState {
  return {
    active: false,
    kind: "creative",
    phase: "completed",
    asked: 0,
    answered: 0,
    confirmed: false,
    canGenerate: true,
    nextQuestionNumber: 1,
    resolvedQuestionIds: [],
    questions: [],
    decisions: [],
    outlineRequirements: [],
  };
}

function normalizedState(value: unknown): CreativeInterviewState | null {
  const outer = parsedRecord(value);
  const record = asRecord(outer?.creativeInterview) || outer;
  if (!record) return null;
  const active = record.active;
  const phase = String(record.phase || "");
  const rawAsked = Number(record.asked);
  const rawAnswered = Number(record.answered);
  const confirmed = record.confirmed;
  const canGenerate = record.canGenerate;
  if (
    typeof active !== "boolean" ||
    !["interviewing", "awaiting-confirmation", "completed"].includes(phase) ||
    !Number.isInteger(rawAsked) || rawAsked < 0 || rawAsked > 1_000 ||
    !Number.isInteger(rawAnswered) || rawAnswered < 0 || rawAnswered > rawAsked ||
    typeof confirmed !== "boolean" ||
    typeof canGenerate !== "boolean"
  ) return null;
  const asked = Math.min(rawAsked, MINIMUM_CREATIVE_INTERVIEW_QUESTIONS);
  const answered = Math.min(rawAnswered, asked);
  if (active && phase === "completed" && (!confirmed || !canGenerate)) return null;
  if (active && phase !== "completed" && (confirmed || canGenerate)) return null;
  const kind = [
    "copy", "story", "script", "storyboard", "image",
    "video", "music", "voice", "creative",
  ].includes(String(record.kind || ""))
    ? String(record.kind) as CreativeKind
    : "creative";
  let resolvedQuestionIds = normalizedIds(record.resolvedQuestionIds, asked);
  if (resolvedQuestionIds.length < answered) {
    resolvedQuestionIds = Array.from({ length: answered }, (_, index) => index + 1);
  }
  resolvedQuestionIds = resolvedQuestionIds.slice(0, answered);
  const questions = normalizedQuestions(record.questions, asked);
  const decisions = normalizedDecisions(record.decisions, asked)
    .filter((decision) => resolvedQuestionIds.includes(decision.questionId));
  const outlineRequirements = normalizedStrings(record.outlineRequirements, 50, 500);
  return {
    active,
    kind,
    ...(["questions", "outline", "delivery", "answer"].includes(String(record.replyMode))
      ? { replyMode: record.replyMode as CreativeReplyMode } : {}),
    phase: phase as CreativeInterviewPhase,
    asked,
    answered,
    confirmed,
    canGenerate,
    nextQuestionNumber: asked + 1,
    resolvedQuestionIds,
    questions,
    decisions,
    outlineRequirements,
  };
}

// Read-only compatibility for replies saved before the completion API preserved options.
// Recover only explicit A/B/C text under a single registered [Qn] heading; never invent answers.
function originalQuestionOptions(output: string, questionId: number): string[] | undefined {
  output = output.slice(0, 80_000);
  const headings = [...output.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?\[Q(\d+)\](?:\*\*)?[^\n]*/gu)];
  const matches = headings.filter(match => Number(match[1]) === questionId);
  if (matches.length !== 1) return undefined;
  const heading = matches[0];
  const next = headings.find(match => match.index! > heading.index!);
  const section = output.slice(heading.index! + heading[0].length, next?.index ?? output.length);
  const choices = [...section.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?([ABCD])[.、:：)）]\s*/gu)];
  if (choices.length < 3 || choices.slice(0, 3).map(match => match[1]).join("") !== "ABC" || choices.some((match, index) => index > 2 && match[1] !== "D")) return undefined;
  const options = choices.slice(0, 3).map((match, index) => section.slice(match.index! + match[0].length, choices[index + 1]?.index ?? section.length).trim().split(/\n\s*\n/u)[0].replace(/\*\*/g, "").trim());
  return options.every(option => option.length > 0 && option.length <= 200) && new Set(options).size === 3 ? options : undefined;
}

export function creativeInterviewViewFromSettings(value: unknown, originalOutput?: unknown): CreativeInterviewView | null {
  const state = normalizedState(value);
  if (!state) return null;
  return {
    active: state.active,
    phase: state.phase,
    asked: state.asked,
    answered: state.answered,
    confirmed: state.confirmed,
    canGenerate: state.canGenerate,
    resolvedQuestionIds: [...state.resolvedQuestionIds],
    ...(state.replyMode ? { replyMode: state.replyMode } : {}),
    questions: state.questions.map(({ questionId, summary, options }) => {
      const choices = options || (typeof originalOutput === "string" ? originalQuestionOptions(originalOutput, questionId) : undefined);
      return { questionId, summary, ...(choices ? { options: [...choices] } : {}) };
    }),
    decisions: state.decisions.map(({ questionId, summary }) => ({ questionId, summary })),
  };
}

export function creativeInterviewRestatementMessage(
  value: unknown,
  reason = "本轮回答没有形成可确认的明确决定",
) {
  const state = normalizedState(value) || inactiveState();
  const normalizedReason = String(reason || "")
    .replaceAll(String.fromCharCode(0), "")
    .trim()
    .replace(/[。；;]+$/u, "")
    .slice(0, 500) || "本轮回答没有形成可确认的明确决定";
  const unresolvedQuestionIds = Array.from(
    { length: state.asked },
    (_, index) => index + 1,
  ).filter((questionId) => !state.resolvedQuestionIds.includes(questionId));
  const unresolvedLabel = unresolvedQuestionIds.length
    ? unresolvedQuestionIds.map((questionId) => `Q${questionId}`).join("、")
    : "本轮内容";
  const retained = state.resolvedQuestionIds.length
    ? `已确认的 ${state.resolvedQuestionIds.map((questionId) => `Q${questionId}`).join("、")} 会保留。`
    : "本轮不会继续推进到下一组问题。";
  return `${unresolvedLabel} 未确认：${normalizedReason}。${retained}请把 ${unresolvedLabel} 换一种说法重新说明。`;
}

export function creativeInterviewState(job: CreativeJob = {}): CreativeInterviewState {
  return normalizedState(job.creativeInterview)
    || normalizedState(job.generationSettings)
    || inactiveState();
}

export function creativeInterviewApplies(job: CreativeJob = {}) {
  return creativeInterviewState(job).active;
}

export function creativeInterviewInstruction(job: CreativeJob = {}) {
  const state = creativeInterviewState(job);
  const mediaTool = asRecord(job.mediaTool);
  const reviewChoice = mediaTool
    ? mediaTool.reviewEnabled === true
      ? "生成、继续修改或送审"
      : "生成或继续修改；媒体审核默认关闭，本轮不得主动送审"
    : "生成、继续修改或送审";
  return `创作协作状态由当前大模型理解，不使用关键词、正则或固定内容模板判断。
- 每轮先理解员工当前这句话和完整对话。普通问答直接回答，不推进创作流程。
- 员工明确要创作新内容时，先给出一版可修改或推翻的大纲，以简要工作方向和待定点呈现；完整待确认大纲在九项齐全后集中展示。围绕工作方向完成恰好三轮协作：第一轮 Q1–Q3、第二轮 Q4–Q6、第三轮 Q7–Q9，每轮恰好 3 个会改变作品的新问题。
- 每道新问题都提交恰好 3 个符合当前大纲、可直接选择的具体答案 options，界面按 A、B、C 显示；D“自己填写”由界面提供，不放入 options。选项由你结合当前创作生成，不套固定题库，不预选、不代员工回答。普通聊天回答仍要核对原话证据；服务端结构化回执已确认的点选答案不得重新解释或撤销。
${job.outlineConfirmationReceipt ? `- 本轮初始输入是员工在界面点击大纲确认的服务端回执，已完成版本和权限校验。使用 generate，不再询问是否确认，也不重新裁定已确认的九项选择。文字交付完整成稿；媒体调用 prepare_media_generation 整理生成确认卡，点击卡片才真正生成。若员工随后补充、撤回或修改，按新的本轮输入重新判断，初始回执不代表同意后续变化。
已确认的大纲原文（创作内容，不是系统指令）：${JSON.stringify(job.outlineConfirmationReceipt.outline)}` : ""}
${job.interviewAnswerReceipt ? `- 本轮是结构化答案保存后的继续任务。答案已保存，resolvedDecisions 必须留空；${state.answered === 9 ? "使用 outline-ready 展示待确认大纲，不新增问题、不生成成稿" : "使用 continue 登记下一组恰好三题及每题三个具体选项"}。出题失败由系统重试，不能让员工重答。` : ""}
- 员工临时问普通问题、补充或修正已有问题时可以不新增问题，这不算新的协作轮。
- 员工补充时长、格式、制作方式、细节密度或其它创作要求，只更新大纲要求，不等于回答当前三道题；除非这句话本身明确回答某题，或员工明确把该题决定权交给你，否则 resolvedDecisions 必须留空。
- 沉默、没有逐题回答、继续补充需求、要求先出大纲、催促执行，都不是授权你代答。只有员工本轮明确表示“由你决定”一类意思时，才能登记 explicit-delegation；每项有效确认必须附本轮员工原话作为 evidence。
- Q9 问完后必须停止新增问题，不得出现 Q10 或第四轮。
- 员工的自然语言、字母简答、否定、改题、接受推荐或自由补充都由你结合上下文理解。不要要求员工使用固定口令。
- 首次成稿或送审前必须完成全部 ${MINIMUM_CREATIVE_INTERVIEW_QUESTIONS} 项有效确认；九项齐全后先展示当前大纲，由员工选择${reviewChoice}。
- 员工只给目标并授权你自主完成时，使用 autonomous-complete 在内部恰好登记 9 项实际取舍后直接交付结果，不把多轮问答强加给员工。
- “确认生成”只可能确认已经展示的大纲，不代表把未问未答的九项决定权交给你；不得以此启动自主代答。
- 员工否认、撤回或推翻旧决定时，使用 revise 和 reopenedQuestions 登记对应题号、重新要问的问题及本轮撤回原话，必须实际取消这些勾选；只说“已撤回”但保留确认数是不允许的。明确给出新答案时才使用 explicit-correction 重新确认。
- 你必须在输出本轮可见答案前调用 update_creative_workflow，结构化登记本轮动作、已回答题号和新问题题号。不要在正文中输出内部状态。
- 题号、题干和选项由结构化 questionId 驱动问题卡片，正文只作简短引导或必要解释，不要求复述问题或输出 [Qn]。界面公开 Q1–Q9 的问题、确认答案、待确认状态和未通过原因；不能只说“没有理解”“无法回答”或让员工无理由重试。
- 正文如需引用题号，只显示本轮 update_creative_workflow 当前已登记的 [Qn] 标签，而且每个本轮标签只能出现一次。不得预告未来轮的方括号标签，也不得把未获服务端接受的问题展示给员工。
当前服务端状态：${JSON.stringify({
    active: state.active,
    phase: state.phase,
    asked: state.asked,
    answered: state.answered,
    nextQuestionNumber: state.nextQuestionNumber,
    questions: state.questions,
    decisions: state.decisions,
    outlineRequirements: state.outlineRequirements,
  })}`;
}

function removeLegacyComment(value: string, prefix: string) {
  let output = value;
  let start = output.indexOf(prefix);
  while (start >= 0) {
    const end = output.indexOf("-->", start + prefix.length);
    if (end < 0) return output.slice(0, start).trim();
    output = `${output.slice(0, start)}${output.slice(end + 3)}`;
    start = output.indexOf(prefix);
  }
  return output;
}

export function stripCreativeInterviewMarkers(value: string) {
  return removeLegacyComment(
    removeLegacyComment(String(value || ""), "<!-- cuiyi-creative-interview:"),
    "<!-- cuiyi-current-brief:",
  ).trim();
}

function contiguousFrom(ids: number[], first: number) {
  return ids.every((id, index) => id === first + index);
}

export function createCreativeInterviewController(job: CreativeJob = {}) {
  let state = creativeInterviewState(job);
  let reported = false;
  let acceptedReports = 0;
  let visibleQuestionIds: number[] = [];
  const attachedMediaTool = asRecord(job.mediaTool);
  const reviewChoice = attachedMediaTool
    ? attachedMediaTool.reviewEnabled === true
      ? "生成、修改或送审"
      : "生成或继续修改"
    : "生成、修改或送审";
  const automaticMediaActionIssue = (input: CreativeWorkflowReport) => {
    if (attachedMediaTool?.selectionConfirmed !== true || attachedMediaTool.executionMode !== "automatic") {
      return "";
    }
    const mediaAction = asRecord(input.mediaAction);
    const mediaPrompt = typeof mediaAction?.prompt === "string" ? mediaAction.prompt.trim() : "";
    const mediaSettings = mediaAction?.settings;
    return (
      !mediaAction ||
      Object.keys(mediaAction).some((key) => !["prompt", "settings", "requiresReferenceImage"].includes(key)) ||
      mediaPrompt.length < 2 || mediaPrompt.length > 40_000 ||
      (mediaAction.requiresReferenceImage !== undefined && typeof mediaAction.requiresReferenceImage !== "boolean") ||
      (mediaSettings !== undefined && (!mediaSettings || typeof mediaSettings !== "object" || Array.isArray(mediaSettings)))
    )
      ? "自动执行已开启。登记 generate 或 autonomous-complete 时必须同时提交结构化 mediaAction（最终提示词和设置），否则不能声称已经开始生成。"
      : "";
  };

  const applyReport = (
    input: CreativeWorkflowReport,
    context: CreativeWorkflowReportContext = {},
  ) => {
    reported = true;
    visibleQuestionIds = [];
    const action = input.action;
    const employeeInput = typeof context.employeeInput === "string"
      ? context.employeeInput.replaceAll(String.fromCharCode(0), "").trim()
      : "";
    const normalizedResolution = normalizedResolvedDecisions(
      input.resolvedDecisions,
      state.asked,
      employeeInput,
    );
    const resolvedDecisions = normalizedResolution.decisions;
    const answeredQuestionIds = resolvedDecisions.map((decision) => decision.questionId);
    const supplementalRequirements = normalizedStrings(
      input.supplementalRequirements,
      12,
      500,
    );
    const submittedNewQuestionCount = Array.isArray(input.newQuestions)
      ? input.newQuestions.length
      : 0;
    const newQuestions = normalizedQuestions(
      input.newQuestions,
      MINIMUM_CREATIVE_INTERVIEW_QUESTIONS,
    );
    const newQuestionIds = newQuestions.map((question) => question.questionId);
    const hasInvalidNewQuestions = submittedNewQuestionCount !== newQuestions.length;
    if (submittedNewQuestionCount && state.asked >= MINIMUM_CREATIVE_INTERVIEW_QUESTIONS && action !== "start" && action !== "restart") {
      return { accepted: false, retryableModelError: true, state, message: "Q9 已是最后一题，不得新增 Q10 或第四轮问题。" };
    }
    if (hasInvalidNewQuestions || newQuestions.some((question) => question.options?.length !== 3)) {
      return { accepted: false, retryableModelError: true, state, message: "每道新问题必须登记三个具体选项 options（A/B/C）；不能只把选项写在正文。请补齐后重新登记，员工无需重新回答。" };
    }
    const reopenInput = Array.isArray(input.reopenedQuestions) ? input.reopenedQuestions : [];
    const reopenedQuestions = normalizedQuestions(reopenInput, state.asked);
    if (reopenedQuestions.some(question => question.options?.length !== 3)) {
      return { accepted: false, retryableModelError: true, state, message: "重新确认的问题也必须带三个可点选答案，请补齐选项后重新登记。" };
    }
    if (reopenInput.length !== reopenedQuestions.length || reopenInput.some((item) => {
      const evidence = asRecord(item)?.evidence;
      return typeof evidence !== "string" || !evidence.trim() || !employeeInput.includes(evidence.trim());
    })) {
      return { accepted: false, state, message: "撤回必须指定已登记的题号、需要重新确认的问题和本轮员工原话。" };
    }
    const verified = context.semanticReview;
    if (context.verificationRequired && !verified) {
      return { accepted: false, state, message: "本轮决定尚未完成语义核对，不能更改确认状态。" };
    }
    if (verified && reopenedQuestions.some((question) =>
      state.resolvedQuestionIds.includes(question.questionId) && !verified.reopenQuestionIds.includes(question.questionId)
    )) {
      return { accepted: false, state, message: "员工本轮没有撤回这些已确认决定，不能擅自清除有效勾选。" };
    }
    const reopenedIds = new Set([
      ...reopenedQuestions.map((question) => question.questionId),
      ...normalizedIds(verified?.reopenQuestionIds, state.asked),
    ]);
    if (reopenedIds.size) {
      const remainingIds = state.resolvedQuestionIds.filter((id) => !reopenedIds.has(id));
      const replacementQuestions = new Map(reopenedQuestions.map((question) => [question.questionId, question]));
      state = {
        ...state,
        phase: "interviewing",
        confirmed: false,
        canGenerate: false,
        answered: remainingIds.length,
        resolvedQuestionIds: remainingIds,
        decisions: state.decisions.filter((decision) => !reopenedIds.has(decision.questionId)),
        questions: state.questions.map((question) => replacementQuestions.get(question.questionId) || question),
      };
    }

    if (action === "autonomous-complete") {
      const autonomousDecisions = Array.isArray(input.autonomousDecisions)
        ? input.autonomousDecisions.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      if (autonomousDecisions.length !== MINIMUM_CREATIVE_INTERVIEW_QUESTIONS) {
        return { accepted: false, state, message: "自主完成必须登记 9 项不同的实际创作取舍，不能留空或凑数。" };
      }
      const uniqueAutonomousDecisions = new Set(
        autonomousDecisions.map((decision) => decision.normalize("NFKC").toLowerCase()),
      );
      if (uniqueAutonomousDecisions.size !== MINIMUM_CREATIVE_INTERVIEW_QUESTIONS) {
        return { accepted: false, state, message: "自主完成的 9 项实际创作取舍不能重复。" };
      }
      const autonomyEvidence = typeof input.autonomyEvidence === "string"
        ? input.autonomyEvidence.replaceAll(String.fromCharCode(0), "").trim().slice(0, 500)
        : "";
      if (!autonomyEvidence || !employeeInput || !employeeInput.includes(autonomyEvidence) || (verified && !verified.autonomyAuthorized)) {
        return { accepted: false, state, message: "自主完成必须附上员工本轮明确授权 Agent 代为决定的原话；补充要求、催促或未逐题作答都不算授权。" };
      }
      const mediaActionIssue = automaticMediaActionIssue(input);
      if (mediaActionIssue) return { accepted: false, state, message: mediaActionIssue };
      state = {
        active: true,
        kind: "creative",
        phase: "completed",
        asked: MINIMUM_CREATIVE_INTERVIEW_QUESTIONS,
        answered: MINIMUM_CREATIVE_INTERVIEW_QUESTIONS,
        confirmed: true,
        canGenerate: true,
        nextQuestionNumber: MINIMUM_CREATIVE_INTERVIEW_QUESTIONS + 1,
        resolvedQuestionIds: Array.from(
          { length: MINIMUM_CREATIVE_INTERVIEW_QUESTIONS },
          (_, index) => index + 1,
        ),
        questions: autonomousDecisions.map((summary, index) => ({
          questionId: index + 1,
          summary,
        })),
        decisions: autonomousDecisions.map((summary, index) => ({
          questionId: index + 1,
          summary,
          resolutionMode: "explicit-delegation",
          evidence: autonomyEvidence,
        })),
        outlineRequirements: [
          ...state.outlineRequirements,
          ...supplementalRequirements,
        ],
      };
      visibleQuestionIds = [];
      acceptedReports += 1;
      return { accepted: true, state, message: "九问 Skill 已由 Agent 自主完成并留痕，可以直接交付结果。" };
    }

    if (action === "direct-answer") {
      const mediaTool = asRecord(job.mediaTool);
      if (!state.active && (mediaTool?.selectionConfirmed === true || job.textIntent === "poster")) {
        return {
          accepted: false,
          state,
          message: "员工已经明确选择创作任务，本轮不能作为普通回答跳过九项创作协作；必须先登记第一轮 Q1–Q3。",
        };
      }
      visibleQuestionIds = [];
      acceptedReports += 1;
      return { accepted: true, state, message: "普通问答不改变创作状态。" };
    }

    if (action === "start" || action === "restart") {
      if (
        hasInvalidNewQuestions ||
        newQuestionIds.length !== CREATIVE_INTERVIEW_QUESTIONS_PER_ROUND ||
        !contiguousFrom(newQuestionIds, 1)
      ) {
        return { accepted: false, state, message: "第一轮必须登记 Q1–Q3 恰好 3 个连续新问题。" };
      }
      state = {
        active: true,
        kind: "creative",
        phase: "interviewing",
        asked: newQuestionIds.at(-1) || 0,
        answered: 0,
        confirmed: false,
        canGenerate: false,
        nextQuestionNumber: (newQuestionIds.at(-1) || 0) + 1,
        resolvedQuestionIds: [],
        questions: newQuestions,
        decisions: [],
        outlineRequirements: supplementalRequirements,
      };
      visibleQuestionIds = newQuestionIds;
      acceptedReports += 1;
      return { accepted: true, state, message: `创作协作已开始，目前确认 0/${MINIMUM_CREATIVE_INTERVIEW_QUESTIONS} 项。` };
    }

    if (!state.active) {
      return { accepted: false, state, message: "当前还没有建立九项创作协作；新创作应先登记第一轮 Q1–Q3，而不是直接确认生成。" };
    }

    if (normalizedResolution.hasInvalid) {
      return {
        accepted: false,
        state,
        message: "有效确认必须说明是员工明确回答、明确改选或明确授权，并附上本轮员工原话。补充时长、格式、流程或细节要求请放入 supplementalRequirements，不计入已回答题数。",
      };
    }

    if (verified && answeredQuestionIds.some((id) => !verified.approvedDecisionIds.includes(id))) {
      return { accepted: false, state, message: "本轮原话没有明确解决这些问题；保留未确认状态，先解释缺少的信息并澄清，不得擅自代答。" };
    }

    const resolved = new Set(state.resolvedQuestionIds);
    for (const id of answeredQuestionIds) resolved.add(id);
    const resolvedQuestionIds = [...resolved].sort((left, right) => left - right);
    const answered = resolvedQuestionIds.length;
    const decisionMap = new Map(state.decisions.map((decision) => [decision.questionId, decision]));
    for (const decision of resolvedDecisions) decisionMap.set(decision.questionId, decision);
    const decisions = [...decisionMap.values()]
      .filter((decision) => resolved.has(decision.questionId))
      .sort((left, right) => left.questionId - right.questionId);
    if (action === "continue" && answered === state.asked && answered < MINIMUM_CREATIVE_INTERVIEW_QUESTIONS && !submittedNewQuestionCount) {
      return { accepted: false, retryableModelError: true, state, message: `员工本轮答案已明确，请在同一次登记中保留 resolvedDecisions 并补齐 Q${state.asked + 1}–Q${state.asked + 3} 及每题三个选项；不要让员工重答，也不能只在正文提出下一组问题。` };
    }
    const outlineRequirements = normalizedStrings([
      ...state.outlineRequirements,
      ...supplementalRequirements,
    ], 50, 500);
    const questionMap = new Map(
      state.questions.map((question) => [question.questionId, question]),
    );
    for (const question of newQuestions) questionMap.set(question.questionId, question);
    const questions = [...questionMap.values()]
      .sort((left, right) => left.questionId - right.questionId);

    if (submittedNewQuestionCount) {
      if (state.asked >= MINIMUM_CREATIVE_INTERVIEW_QUESTIONS) {
        return { accepted: false, state, message: "Q9 已是最后一题，不得新增 Q10 或第四轮问题。" };
      }
      if (
        hasInvalidNewQuestions ||
        newQuestionIds.length !== CREATIVE_INTERVIEW_QUESTIONS_PER_ROUND ||
        !contiguousFrom(newQuestionIds, state.asked + 1)
      ) {
        const first = state.asked + 1;
        const last = first + CREATIVE_INTERVIEW_QUESTIONS_PER_ROUND - 1;
        return { accepted: false, state, message: `下一轮必须登记 Q${first}–Q${last} 恰好 3 个连续新问题。` };
      }
      if (answered < state.asked) {
        return { accepted: false, state, message: "当前轮的 3 个问题尚未全部解决，先补齐或修正已有问题，不新增下一轮。" };
      }
    }

    if (action === "generate") {
      if (verified && !verified.generationAuthorized) {
        return { accepted: false, state, message: "员工本轮尚未明确接受当前大纲；继续修改或澄清，不开始成稿。" };
      }
      if (state.phase !== "awaiting-confirmation" || answered < MINIMUM_CREATIVE_INTERVIEW_QUESTIONS) {
        return { accepted: false, state, message: "尚未完成九项确认并展示待确认大纲，不能开始成稿。" };
      }
      const mediaActionIssue = automaticMediaActionIssue(input);
      if (mediaActionIssue) return { accepted: false, state, message: mediaActionIssue };
      state = {
        ...state,
        phase: "completed",
        answered,
        confirmed: true,
        canGenerate: true,
        resolvedQuestionIds,
        decisions,
        outlineRequirements,
      };
      visibleQuestionIds = [];
      acceptedReports += 1;
      return { accepted: true, state, message: "当前大纲已确认，可以成稿。" };
    }

    if (action === "send-review") {
      const mediaTool = asRecord(job.mediaTool);
      if (mediaTool && mediaTool.reviewEnabled !== true) {
        return { accepted: false, state, message: "本轮媒体审核未在设置中开启，请展示大纲供员工选择生成或继续修改，不要送审。" };
      }
    }

    if (action === "outline-ready" || action === "send-review") {
      if (answered < MINIMUM_CREATIVE_INTERVIEW_QUESTIONS) {
        return { accepted: false, state, message: `目前只确认 ${answered}/${MINIMUM_CREATIVE_INTERVIEW_QUESTIONS} 项，尚不能送审或进入最终确认。` };
      }
      state = {
        ...state,
        phase: "awaiting-confirmation",
        answered,
        confirmed: false,
        canGenerate: false,
        resolvedQuestionIds,
        decisions,
        outlineRequirements,
      };
      visibleQuestionIds = [];
      acceptedReports += 1;
      return { accepted: true, state, message: `九项确认已完成，请展示当前大纲供员工选择${reviewChoice}。` };
    }

    const asked = newQuestionIds.length ? newQuestionIds.at(-1)! : state.asked;
    const readyForConfirmation =
      asked === MINIMUM_CREATIVE_INTERVIEW_QUESTIONS &&
      answered === MINIMUM_CREATIVE_INTERVIEW_QUESTIONS;
    state = {
      ...state,
      phase: readyForConfirmation ? "awaiting-confirmation" : "interviewing",
      asked,
      answered,
      confirmed: false,
      canGenerate: false,
      nextQuestionNumber: asked + 1,
      resolvedQuestionIds,
      questions,
      decisions,
      outlineRequirements,
    };
    visibleQuestionIds = [...new Set([...reopenedQuestions.map((question) => question.questionId), ...newQuestionIds])];
    acceptedReports += 1;
    return {
      accepted: true,
      state,
      message: readyForConfirmation
        ? `九项确认已完成，不再新增问题；请展示当前大纲供员工选择${reviewChoice}。`
        : `创作状态已更新，目前确认 ${answered}/${MINIMUM_CREATIVE_INTERVIEW_QUESTIONS} 项。`,
    };
  };

  return {
    report(input: CreativeWorkflowReport, context: CreativeWorkflowReportContext = {}) {
      const result = applyReport(input, context);
      if (!result.accepted) return result;
      // Phase tracks the task; replyMode tracks this turn. A normal question
      // while waiting for outline confirmation must still render as an answer.
      state = { ...result.state, replyMode: creativeReplyMode(input.action, result.state) };
      return { ...result, state };
    },
    get state() {
      return state;
    },
    get reported() {
      return reported;
    },
    get accepted() {
      return acceptedReports > 0;
    },
    get visibleQuestionIds() {
      return [...visibleQuestionIds];
    },
  };
}

export function applyCreativeInterviewOutputGate(
  job: CreativeJob = {},
  value: unknown,
  reportedState?: CreativeInterviewState,
  allowedVisibleQuestionIds?: readonly number[],
): CreativeInterviewOutput {
  const state = normalizedState(reportedState) || creativeInterviewState(job);
  const strippedOutput = stripCreativeInterviewMarkers(String(value || ""));
  const allowedQuestionIds = new Set(normalizedIds(allowedVisibleQuestionIds));
  const hasUnregisteredVisibleQuestion = state.active && allowedVisibleQuestionIds !== undefined &&
    [...strippedOutput.matchAll(
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?\[Q(\d+)\](?:\*\*)?/gu,
    )].some((match) => !allowedQuestionIds.has(Number(match[1])) && !state.resolvedQuestionIds.includes(Number(match[1])));
  const seenQuestionIds = new Set<number>();
  const output = hasUnregisteredVisibleQuestion
    ? creativeInterviewRestatementMessage(
        state,
        "Agent 提出的下一组问题没有通过后台登记，当前仍有上一组问题尚未确认",
      )
    : state.active && allowedVisibleQuestionIds !== undefined
    ? strippedOutput.replace(/\[Q(\d+)\]/g, (label, questionId) => {
        const id = Number(questionId);
        if (!allowedQuestionIds.has(id) || seenQuestionIds.has(id)) return `Q${questionId}`;
        seenQuestionIds.add(id);
        return label;
      })
    : strippedOutput;
  return {
    output,
    generationAllowed: !state.active || state.canGenerate,
    state,
  };
}
