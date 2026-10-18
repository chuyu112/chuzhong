import { isKimiCodeModel } from "./kimi-model-config.mjs";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { AGENT_MODEL_UNAVAILABLE_MESSAGE } from "../lib/text-output-safety.ts";
import {
  MAXIMUM_AGENT_CONTEXT_TOKENS,
  estimateAgentContextTokens,
} from "./text-runtime.mjs";
import { directModelImageAssets } from "./text-model-inputs.mjs";
import { KIMI_CONTEXT_WINDOW_TOKENS, KIMI_MAX_COMPLETION_TOKENS } from "./kimi-model-config.mjs";

export const CUIYI_PI_HARNESS_VERSION = "cuiyi-pi-harness/1";
export const CUIYI_PI_SESSION_PROTOCOL_VERSION = 1;

const MAXIMUM_HISTORY_MESSAGES = 200;
const MAXIMUM_HISTORY_CHARACTERS = 800_000;
const MAXIMUM_EVENT_TEXT_CHARACTERS = 160_000;
const REDACTED_EVENT_VALUE = "[REDACTED]";
const DEFAULT_HARNESS_CONTEXT_WINDOW_TOKENS = 256_000;

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }),
});

function normalizeSessionPart(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .slice(0, 180);
  return normalized || fallback;
}

function normalizeCheckpointJobId(value, fallback) {
  const normalized = String(value || "").trim().slice(0, 180);
  return /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(normalized)
    ? normalized
    : fallback;
}

function normalizeAgentRole(value) {
  if (value === "review") return "review";
  if (value === "memory") return "memory";
  return "creator";
}

export function cuiyiHarnessSessionId(job) {
  const runId = normalizeSessionPart(job?.id, "run");
  const conversationId = normalizeSessionPart(
    job?.conversationId || job?.conversation_id,
    `conversation-${runId}`,
  );
  // Keep this identity rule aligned with lib/harness-events.ts. Moments visual
  // checks need direct image input and each attempt must have an isolated,
  // immutable Pi session regardless of their role migration history.
  if (/^moments-media:\d{4}-\d{2}-\d{2}:\d+(?::repair-\d+)?:semantic-review(?::retry-\d+)?$/u.test(String(job?.id || ""))) {
    return `${conversationId}.moments-review.${runId}`;
  }
  if (job?.agentRole === "review") {
    return `${conversationId}.review.${runId}`;
  }
  if (job?.agentRole === "memory") {
    return `${conversationId}.memory.${runId}`;
  }
  if (job?.channelId === "account-profile-generation") {
    return `${conversationId}.profile.${runId}`;
  }
  return conversationId;
}

function harnessContextWindow(job) {
  const isKimi = isKimiCodeModel(job?.modelId) || isKimiCodeModel(job?.textModelId);
  const defaultWindow = isKimi ? KIMI_CONTEXT_WINDOW_TOKENS : DEFAULT_HARNESS_CONTEXT_WINDOW_TOKENS;
  const maximumWindow = isKimi ? KIMI_CONTEXT_WINDOW_TOKENS : MAXIMUM_AGENT_CONTEXT_TOKENS;
  const configured = Number(
    job?.harnessContextWindowTokens ||
    process.env.DIRECTOR_HARNESS_CONTEXT_WINDOW_TOKENS ||
    defaultWindow,
  );
  if (!Number.isFinite(configured)) return defaultWindow;
  return Math.max(256, Math.min(maximumWindow, Math.floor(configured)));
}

function createOpaqueDirectorModel(job) {
  const routedModelId = normalizeSessionPart(
    job?.textModelId || job?.modelId,
    "director-text",
  );
  return {
    id: routedModelId,
    name: `Cuiyi routed model (${routedModelId})`,
    api: "cuiyi-router",
    provider: "cuiyi-router",
    baseUrl: "",
    reasoning: job?.responseMode === "reasoning",
    input: directModelImageAssets(job).length ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: harnessContextWindow(job),
    maxTokens: isKimiCodeModel(job?.modelId) || isKimiCodeModel(job?.textModelId)
      ? KIMI_MAX_COMPLETION_TOKENS
      : 32_768,
  };
}

function createAssistantMessage(model, content, stopReason, errorMessage, usage = EMPTY_USAGE) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function estimatedUsage(input, output) {
  const inputTokens = Math.max(1, estimateAgentContextTokens(input));
  const outputTokens = Math.max(1, estimateAgentContextTokens(output));
  return {
    input: inputTokens,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: inputTokens + outputTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function abortCause(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

async function waitForRunModel(runModelPromise, signal) {
  if (!signal) return await runModelPromise;
  if (signal.aborted) {
    void Promise.resolve(runModelPromise).catch(() => undefined);
    throw abortCause(signal);
  }

  let removeAbortListener = () => {};
  const aborted = new Promise((_, reject) => {
    const onAbort = () => reject(abortCause(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([runModelPromise, aborted]);
  } finally {
    removeAbortListener();
  }
}

function normalizeRunModelResult(result) {
  const finalText = typeof result === "string"
    ? result
    : result && typeof result.finalText === "string"
      ? result.finalText
      : "";
  const rawToolCalls = result && typeof result === "object" && Array.isArray(result.toolCalls)
    ? result.toolCalls
    : [];
  const toolCalls = rawToolCalls.slice(0, 16).map((call) => {
    const id = String(call?.id || "").trim().slice(0, 200);
    const name = String(call?.name || "").trim().slice(0, 160);
    const args = call?.arguments;
    if (
      !id || !name || !/^[A-Za-z0-9_.:-]+$/.test(id) || !/^[A-Za-z0-9_-]+$/.test(name) ||
      !args || typeof args !== "object" || Array.isArray(args)
    ) throw new TypeError("runModel 返回了无效工具调用");
    return { type: "toolCall", id, name, arguments: args };
  });
  if (!finalText.trim() && !toolCalls.length) {
    throw new TypeError("runModel 必须返回正文或工具调用");
  }
  return { finalText: finalText.trim(), toolCalls };
}

export function visibleMessageText(message, maximum = MAXIMUM_EVENT_TEXT_CHARACTERS) {
  if (typeof message?.content === "string") {
    return message.content.slice(0, maximum);
  }
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .slice(0, maximum);
}

// Pi owns the transcript format. Only this adapter replays its system/tool
// deltas; downstream providers keep consuming Cuiyi's resolved context shape.
export function cuiyiModelContext(transcript) {
  const messages = transcript?.messages;
  if (!Array.isArray(messages) || messages.some((message) =>
    !["system", "user", "assistant", "toolResult"].includes(message?.role)
  )) throw new TypeError("Pi 模型上下文包含不支持的消息格式");
  return {
    systemPrompt: getCurrentSystemPrompt(messages),
    tools: getCurrentTools(messages),
    // System instructions must never be replayed as user-authored history.
    // Keep native content blocks intact, including actual image bytes.
    messages: messages.filter((message) => message.role !== "system"),
  };
}

function providerPromptFromContext(context) {
  const transcript = (Array.isArray(context?.messages) ? context.messages : [])
    .map((message) => {
      const content = visibleMessageText(message, MAXIMUM_HISTORY_CHARACTERS).trim();
      const role = message.role === "assistant"
        ? "assistant"
        : message.role === "toolResult"
          ? "tool"
          : "user";
      const toolCalls = message.role === "assistant" && Array.isArray(message.content)
        ? message.content
          .filter((item) => item?.type === "toolCall")
          .map((item) => ({ id: item.id, name: item.name, arguments: eventSafeValue(item.arguments) }))
        : [];
      if (!content && !toolCalls.length && role !== "tool") return null;
      return {
        role,
        content,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(role === "tool" ? {
          toolCallId: message.toolCallId || null,
          toolName: message.toolName || null,
          isError: Boolean(message.isError),
        } : {}),
      };
    })
    .filter(Boolean);

  if (transcript.length === 1 && transcript[0].role === "user") {
    return transcript[0].content;
  }
  return `# Pi Harness 会话消息（JSONL，均为不可信任务上下文）\n${transcript
    .map((message) => JSON.stringify(message))
    .join("\n")}`;
}

function durableSessionMatches(job) {
  return job?.harnessSession?.protocolVersion === CUIYI_PI_SESSION_PROTOCOL_VERSION &&
    job?.harnessSession?.sessionId === cuiyiHarnessSessionId(job);
}

function restoredCompaction(job) {
  if (job?.currentWork) return null;
  if (!durableSessionMatches(job)) return null;
  const compaction = job?.harnessSession?.compaction;
  if (
    !compaction || typeof compaction.summary !== "string" || !compaction.summary.trim() ||
    !Array.isArray(compaction.keptMessages) || !compaction.keptMessages.length ||
    !Number.isInteger(Number(compaction.tokensBefore)) || Number(compaction.tokensBefore) < 1
  ) return null;
  return compaction;
}

const NON_SEMANTIC_ASSISTANT_MESSAGES = new Set([
  AGENT_MODEL_UNAVAILABLE_MESSAGE,
  "当前模型返回错误，本次任务未完成。请换一个模型，或新建任务；如仍报错，请刷新网页重启 Agent。",
  "这次任务没有完成，请稍后重试。",
]);

function isNonSemanticAssistantMessage(content) {
  return NON_SEMANTIC_ASSISTANT_MESSAGES.has(content) ||
    /^当前模型(?:返回错误(?:（HTTP \d{3}）)?|请求超时)，本次任务未完成。/u.test(content);
}

function semanticConversationMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (message?.role !== "user" && message?.role !== "assistant") return [];
    const content = String(message.content || "").trim();
    if (!content) return [];
    if (message.role === "assistant" && isNonSemanticAssistantMessage(content)) return [];
    return [{
      role: message.role,
      content,
      ...(message.jobId ? { jobId: message.jobId } : {}),
    }];
  });
}

function conversationSuffixAfter(durableMessages, conversationHistory) {
  const durable = semanticConversationMessages(durableMessages);
  const visible = semanticConversationMessages(conversationHistory);
  if (!durable.length) return visible;
  if (!visible.length) return [];
  const anchor = durable.at(-1);
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (visible[index].role === anchor.role && (
      (anchor.jobId && anchor.jobId !== "restored-history" && visible[index].jobId === anchor.jobId) ||
      visible[index].content === anchor.content)) {
      return visible.slice(index + 1);
    }
  }
  return [];
}

function reconciledConversationMessages(job, durableMessages) {
  // The server's node boundary is authoritative; an old checkpoint must not revive its questionnaire.
  if (job?.currentWork) return semanticConversationMessages(job.conversationHistory);
  const durable = semanticConversationMessages(durableMessages);
  if (!durable.length) return semanticConversationMessages(job?.conversationHistory);
  return [
    ...durable,
    ...conversationSuffixAfter(durable, job?.conversationHistory),
  ];
}

function historyMessages(job, model) {
  const compaction = restoredCompaction(job);
  if (job?.agentRole === "review" || job?.agentRole === "memory") return [];
  const durableMessages = durableSessionMatches(job) &&
      Array.isArray(job?.harnessSession?.messages) && job.harnessSession.messages.length
    ? job.harnessSession.messages
    : null;
  const history = durableMessages
    ? reconciledConversationMessages(job, compaction?.keptMessages || durableMessages)
    : semanticConversationMessages(job?.conversationHistory).slice(-MAXIMUM_HISTORY_MESSAGES);
  const result = [];
  let characters = 0;
  for (const message of history) {
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const remaining = MAXIMUM_HISTORY_CHARACTERS - characters;
    if (remaining <= 0) break;
    const content = String(message.content || "").trim().slice(0, remaining);
    if (!content) continue;
    characters += content.length;
    if (message.role === "user") {
      result.push({
        role: "user",
        content: [{ type: "text", text: content }],
        timestamp: Date.now() - (history.length - result.length + 1),
      });
    } else {
      result.push(createAssistantMessage(
        model,
        [{ type: "text", text: content }],
        "stop",
      ));
    }
  }
  return result;
}

function checkpointSourceMessages(job) {
  if (job?.agentRole === "review" || job?.agentRole === "memory") return [];
  if (
    durableSessionMatches(job) &&
    Array.isArray(job?.harnessSession?.messages)
  ) {
    return reconciledConversationMessages(job, job.harnessSession.messages);
  }
  return semanticConversationMessages(job?.conversationHistory)
    .map((message) => ({
        role: message?.role,
        content: message?.content,
        jobId: "restored-history",
      }));
}

function boundedCheckpointMessages(messages) {
  const selected = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const content = String(message.content || "").replaceAll(String.fromCharCode(0), "").trim()
      .slice(0, MAXIMUM_EVENT_TEXT_CHARACTERS);
    if (!content) continue;
    const jobId = normalizeCheckpointJobId(message.jobId, "restored-history");
    if (selected.length >= MAXIMUM_HISTORY_MESSAGES || characters + content.length > MAXIMUM_HISTORY_CHARACTERS) {
      break;
    }
    selected.push({ role: message.role, content, jobId });
    characters += content.length;
  }
  return selected.reverse();
}

export function createCuiyiPiHarnessCheckpoint(
  job,
  finalText,
  deliveredInputs = [],
  compaction = null,
) {
  const sessionId = cuiyiHarnessSessionId(job);
  const baseStateVersion = durableSessionMatches(job)
    ? Number(job.harnessSession.stateVersion ?? 0)
    : 0;
  if (!Number.isInteger(baseStateVersion) || baseStateVersion < 0) {
    throw new TypeError("Pi Session stateVersion 无效");
  }
  const currentPrompt = String(job?.prompt || "").trim();
  const visibleOutput = String(finalText || "").trim();
  if (!currentPrompt || !visibleOutput) throw new TypeError("Pi Session 检查点缺少当前消息");
  if (!Array.isArray(deliveredInputs)) throw new TypeError("Pi Session 追加输入无效");
  const deliveredMessages = deliveredInputs.map((input) => {
    const content = String(input?.content || "").replaceAll(String.fromCharCode(0), "").trim();
    if (!content) throw new TypeError("Pi Session 追加输入内容为空");
    return { role: "user", content, jobId: String(job.id) };
  });
  const messages = boundedCheckpointMessages([
    ...checkpointSourceMessages(job),
    { role: "user", content: currentPrompt, jobId: String(job.id) },
    ...deliveredMessages,
    { role: "assistant", content: visibleOutput, jobId: String(job.id) },
  ]);
  const currentPair = messages.slice(-2);
  const checkpointJobId = normalizeCheckpointJobId(job.id, "run");
  if (
    currentPair[0]?.role !== "user" || currentPair[0]?.jobId !== checkpointJobId ||
    currentPair[1]?.role !== "assistant" || currentPair[1]?.jobId !== checkpointJobId
  ) {
    throw new TypeError("Pi Session 检查点超过安全上限");
  }
  return {
    harnessVersion: CUIYI_PI_HARNESS_VERSION,
    protocolVersion: CUIYI_PI_SESSION_PROTOCOL_VERSION,
    sessionId,
    runId: String(job.id),
    baseStateVersion,
    messages,
    ...(compaction ? { compaction } : {}),
    createdAt: new Date().toISOString(),
  };
}

function eventSafeValue(value, depth = 0) {
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value ?? null;
  }
  if (typeof value === "string") return value.slice(0, MAXIMUM_EVENT_TEXT_CHARACTERS);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => eventSafeValue(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 1_000);

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/authorization|cookie|credential|password|secret|token|api[-_]?key/i.test(key)) {
      result[key] = REDACTED_EVENT_VALUE;
    } else {
      result[key] = eventSafeValue(item, depth + 1);
    }
  }
  return result;
}

function durationFields(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { durationMs: value }
    : {};
}

function normalizedPiEvent(event) {
  switch (event?.type) {
    case "agent_start":
      return { eventType: `pi.${event.type}`, payload: {} };
    case "agent_settled":
      return { eventType: "pi.agent_settled", payload: { aborted: Boolean(event.aborted) } };
    case "agent_end":
      return {
        eventType: "pi.agent_end",
        payload: {
          messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
          willRetry: Boolean(event.willRetry),
        },
      };
    case "turn_start":
      return { eventType: "pi.turn_start", payload: { turnIndex: Number(event.turnIndex || 0) } };
    case "turn_end":
      return {
        eventType: "pi.turn_end",
        payload: {
          turnIndex: Number(event.turnIndex || 0),
          toolResultCount: Array.isArray(event.toolResults) ? event.toolResults.length : 0,
          stopReason: typeof event.message?.stopReason === "string" ? event.message.stopReason : null,
        },
      };
    case "message_end": {
      if (!["user", "assistant", "toolResult", "custom"].includes(event.message?.role)) return null;
      const eventRole = event.message.role
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase();
      return {
        eventType: `pi.message.${eventRole}.end`,
        payload: {
          role: event.message.role,
          content: visibleMessageText(event.message),
          // Correlate the model-facing result with execution start/end by the
          // original Pi call ID. Reference: Codex 53c542d944c705f3a66780a19223223bee57cbb6,
          // codex-rs/core/src/tools/tool_dispatch_trace.rs (see adaptation notes).
          ...(event.message.role === "toolResult" ? {
            toolCallId: String(event.message.toolCallId || "").slice(0, 200),
            toolName: String(event.message.toolName || "").slice(0, 160),
            isError: Boolean(event.message.isError),
          } : {}),
          ...(event.message.role === "assistant"
            ? { stopReason: event.message.stopReason || null }
            : {}),
          ...durationFields(event.message.durationMs),
        },
      };
    }
    case "tool_execution_start":
      return {
        eventType: "pi.tool.start",
        payload: {
          toolCallId: String(event.toolCallId || "").slice(0, 200),
          toolName: String(event.toolName || "").slice(0, 160),
          args: eventSafeValue(event.args),
        },
      };
    case "tool_execution_end":
      return {
        eventType: "pi.tool.end",
        payload: {
          toolCallId: String(event.toolCallId || "").slice(0, 200),
          toolName: String(event.toolName || "").slice(0, 160),
          isError: Boolean(event.isError),
          result: eventSafeValue(event.result),
          ...durationFields(event.durationMs),
        },
      };
    case "queue_update":
      return {
        eventType: "pi.queue.update",
        payload: {
          steering: eventSafeValue(event.steering || []),
          followUp: eventSafeValue(event.followUp || []),
        },
      };
    case "compaction_start":
      return { eventType: "pi.compaction.start", payload: { reason: event.reason } };
    case "compaction_end":
      return {
        eventType: "pi.compaction.end",
        payload: {
          reason: event.reason,
          aborted: Boolean(event.aborted),
          willRetry: Boolean(event.willRetry),
          summary: typeof event.result?.summary === "string"
            ? event.result.summary.slice(0, MAXIMUM_EVENT_TEXT_CHARACTERS)
            : null,
          firstKeptEntryId: event.result?.firstKeptEntryId || null,
          tokensBefore: Number(event.result?.tokensBefore || 0),
          estimatedTokensAfter: Number(event.result?.estimatedTokensAfter || 0),
          errorMessage: typeof event.errorMessage === "string"
            ? event.errorMessage.slice(0, 2_000)
            : null,
        },
      };
    case "auto_retry_start":
    case "auto_retry_end":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
      return { eventType: `pi.${event.type}`, payload: eventSafeValue(event) };
    default:
      return null;
  }
}

function checkpointCompactionMessages(sessionManager) {
  const messages = [];
  let characters = 0;
  for (const entry of sessionManager.buildContextEntries()) {
    if (entry?.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    const content = visibleMessageText(message).replaceAll(String.fromCharCode(0), "").trim();
    if (!content) continue;
    if (messages.length >= 120 || characters + content.length > 480_000) {
      throw new Error("Pi compaction 检查点超过安全上限");
    }
    messages.push({ role: message.role, content });
    characters += content.length;
  }
  return messages;
}

function durableCompactionFromSession(sessionManager, latestRuntimeCompaction) {
  const latestEntry = [...sessionManager.getBranch()]
    .reverse()
    .find((entry) => entry?.type === "compaction");
  if (!latestEntry) return null;
  const keptMessages = checkpointCompactionMessages(sessionManager);
  if (!keptMessages.length) return null;
  const restoredDetails = latestEntry.details?.cuiyiRestoredCompaction;
  const runtimeMatches = latestRuntimeCompaction?.summary === latestEntry.summary;
  const estimatedTokensAfter = runtimeMatches
    ? Number(latestRuntimeCompaction.estimatedTokensAfter ?? 0)
    : Number(restoredDetails?.estimatedTokensAfter ?? 0);
  const compactedAt = runtimeMatches
    ? latestRuntimeCompaction.compactedAt
    : restoredDetails?.compactedAt || latestEntry.timestamp;
  return {
    summary: latestEntry.summary,
    keptMessages,
    tokensBefore: Number(latestEntry.tokensBefore),
    estimatedTokensAfter: Number.isInteger(estimatedTokensAfter) && estimatedTokensAfter >= 0
      ? estimatedTokensAfter
      : null,
    compactedAt: new Date(compactedAt).toISOString(),
  };
}

function createDirectorModelRuntime({ job, runModel, onFailure }) {
  const model = createOpaqueDirectorModel(job);
  return {
    model,
    runtime: {
      getModel(provider, modelId) {
        return provider === model.provider && modelId === model.id ? model : undefined;
      },
      getAvailableSnapshot() {
        return [model];
      },
      hasConfiguredAuth(provider) {
        return provider === model.provider;
      },
      async checkAuth(provider) {
        return provider === model.provider ? { type: "cuiyi-router" } : undefined;
      },
      isUsingOAuth() {
        return false;
      },
      async getAuth() {
        return undefined;
      },
      registerProvider() {},
      registerNativeProvider() {},
      unregisterProvider() {},
      streamSimple(streamModel, transcript, options = {}) {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          try {
            if (options.signal?.aborted) throw abortCause(options.signal);
            const context = cuiyiModelContext(transcript);
            const prompt = providerPromptFromContext(context);
            const result = await waitForRunModel(
              Promise.resolve().then(() => runModel({
                job,
                prompt,
                signal: options.signal,
                model: streamModel,
                context,
                harnessVersion: CUIYI_PI_HARNESS_VERSION,
              })),
              options.signal,
            );
            if (options.signal?.aborted) throw abortCause(options.signal);
            const { finalText, toolCalls } = normalizeRunModelResult(result);
            const content = [
              ...(finalText ? [{ type: "text", text: finalText }] : []),
              ...toolCalls,
            ];
            const stopReason = toolCalls.length ? "toolUse" : "stop";
            const message = createAssistantMessage(
              streamModel,
              content,
              stopReason,
              undefined,
              estimatedUsage(prompt, finalText || JSON.stringify(toolCalls)),
            );
            stream.push({ type: "start", partial: message });
            stream.push({ type: "done", reason: stopReason, message });
          } catch (error) {
            onFailure(error);
            const aborted = options.signal?.aborted || error?.name === "AbortError";
            const message = createAssistantMessage(
              streamModel,
              [],
              aborted ? "aborted" : "error",
              aborted ? "文字创作已取消" : AGENT_MODEL_UNAVAILABLE_MESSAGE,
            );
            stream.push({
              type: "error",
              reason: aborted ? "aborted" : "error",
              error: message,
            });
          }
        })();
        return stream;
      },
    },
  };
}

export async function createCuiyiPiHarnessSession({
  job,
  runModel,
  systemPrompt,
  onHarnessEvent,
  customTools = [],
  cwd = process.cwd(),
}) {
  if (!Array.isArray(customTools)) {
    throw new TypeError("Pi customTools 必须是数组");
  }
  // Review is a separate, read-only Agent boundary.  Even if a caller is
  // accidentally handed creator tools, do not register them in its Pi
  // session.  Review knowledge is injected from its own frozen review input
  // and independent retrieval path instead of inheriting creator actions.
  const effectiveCustomTools = job?.agentRole === "review" ? [] : customTools;
  const sessionId = cuiyiHarnessSessionId(job);
  const { model, runtime: modelRuntime } = createDirectorModelRuntime({
    job,
    runModel,
    onFailure: (error) => {
      runFailure = error;
    },
  });
  let runFailure;
  let latestRuntimeCompaction = null;
  const attemptId = crypto.randomUUID();
  const eventSource = `pi-session:${sessionId}:attempt:${attemptId}`;
  let sourceSequence = 0;
  let finished = false;
  const events = [];
  const emit = (eventType, payload = {}) => {
    const event = {
      eventId: crypto.randomUUID(),
      harnessVersion: CUIYI_PI_HARNESS_VERSION,
      sessionId,
      runId: String(job.id),
      source: eventSource,
      sourceSequence: ++sourceSequence,
      eventType,
      agentRole: normalizeAgentRole(job.agentRole),
      payload: eventSafeValue(payload),
      occurredAt: new Date().toISOString(),
    };
    events.push(event);
    onHarnessEvent?.(event);
    return event;
  };

  const sessionManager = SessionManager.inMemory(cwd, { id: sessionId });
  sessionManager.appendModelChange(model.provider, model.id);
  sessionManager.appendThinkingLevelChange(job.responseMode === "reasoning" ? "high" : "medium");
  const restoredHistory = historyMessages(job, model);
  const restoredEntryIds = restoredHistory.map((message) => sessionManager.appendMessage(message));
  const compaction = job.agentRole === "creator" ? restoredCompaction(job) : null;
  if (compaction && restoredEntryIds.length) {
    sessionManager.appendCompaction(
      compaction.summary,
      restoredEntryIds[0],
      Number(compaction.tokensBefore),
      {
        cuiyiRestoredCompaction: {
          estimatedTokensAfter: compaction.estimatedTokensAfter ?? null,
          compactedAt: compaction.compactedAt,
        },
      },
      true,
    );
  }

  const outputReserve = isKimiCodeModel(job.modelId) || isKimiCodeModel(job.textModelId)
    ? KIMI_MAX_COMPLETION_TOKENS
    : 16_384;
  const reserveTokens = Math.min(outputReserve, Math.max(64, Math.floor(model.contextWindow / 4)));
  const keepRecentTokens = Math.min(20_000, Math.max(64, Math.floor(model.contextWindow / 4)));
  const settingsManager = SettingsManager.inMemory({
    defaultThinkingLevel: job.responseMode === "reasoning" ? "high" : "medium",
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    retry: { enabled: false },
    // Requests and retries belong to the leased Cuiyi job, never an idle timer.
    cacheWarming: "off",
    compaction: {
      enabled: job.agentRole === "creator",
      reserveTokens,
      keepRecentTokens,
    },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: job.responseMode === "reasoning" ? "high" : "medium",
    modelRuntime,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools: effectiveCustomTools,
    noTools: effectiveCustomTools.length ? "builtin" : "all",
  });

  emit("cuiyi.session.opened", {
    protocolVersion: CUIYI_PI_SESSION_PROTOCOL_VERSION,
    attemptId,
    restoredMessageCount: restoredHistory.length,
    restoredCompaction: Boolean(compaction),
    toolNames: effectiveCustomTools.map((tool) => tool.name),
    isolatedReview: job.agentRole === "review",
    isolatedMemory: job.agentRole === "memory",
    modelId: job.textModelId || job.modelId || null,
  });
  const unsubscribe = session.subscribe((event) => {
    if (event?.type === "compaction_end" && event.result && !event.aborted) {
      latestRuntimeCompaction = {
        ...event.result,
        compactedAt: new Date().toISOString(),
      };
    }
    const normalized = normalizedPiEvent(event);
    if (normalized) emit(normalized.eventType, normalized.payload);
  });

  return {
    session,
    sessionId,
    events,
    get runFailure() {
      return runFailure;
    },
    checkpointCompaction() {
      return durableCompactionFromSession(sessionManager, latestRuntimeCompaction);
    },
    finish(status, detail = {}) {
      if (finished) return;
      finished = true;
      emit("cuiyi.session.closed", { status, ...detail });
    },
    dispose() {
      unsubscribe();
      session.dispose();
    },
  };
}
