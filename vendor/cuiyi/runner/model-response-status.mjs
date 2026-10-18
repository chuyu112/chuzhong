// Only allowlisted provider codes enter logs/public diagnostics. Provider error
// messages can contain credentials, request bodies or private prompt text.
const safeReasons = new Set([
  "max_output_tokens", "max_tokens", "length", "content_filter", "refusal",
  "rate_limit_exceeded", "rate_limit_error", "insufficient_quota",
  "overloaded_error", "engine_overloaded_error", "server_error", "internal_server_error", "api_error",
  "invalid_request_error", "authentication_error", "permission_error",
  "context_length_exceeded", "model_not_found", "incomplete", "failed",
  "cancelled", "pause_turn",
]);

export function modelResponseError(kind, reason) {
  const labels = {
    limit: "文字模型输出达到长度上限，内容未完成",
    upstream: "文字模型接口返回错误",
    incomplete: "文字模型回复未完整结束",
    refused: "文字模型拒绝当前问题",
    empty: "文字模型没有返回可用内容",
  };
  if (!Object.hasOwn(labels, kind)) throw new TypeError("Unknown model response failure");
  const safeReason = safeReasons.has(reason) ? reason : null;
  const error = new Error(`${labels[kind]}${safeReason ? `（${safeReason}）` : ""}`);
  error.code = `MODEL_RESPONSE_${kind.toUpperCase()}`;
  error.claimLost = false;
  return error;
}

/** Inspect both HTTP-200 error bodies and terminal SSE events before accepting
 * any accumulated text/tool calls. Partial output is never a successful reply.
 */
export function assertModelResponseStatus(payload) {
  if (!payload || typeof payload !== "object") return;
  const response = payload.response || payload;
  const failure = payload.error || response.error;
  if (failure || payload.type === "error" || payload.type === "response.failed" || response.status === "failed") {
    const reason = failure?.code || failure?.type;
    throw modelResponseError(reason === "context_length_exceeded" ? "limit" : "upstream", reason);
  }
  const reason = response.incomplete_details?.reason || payload.delta?.stop_reason || payload.stop_reason ||
    payload.choices?.[0]?.finish_reason;
  if (["length", "max_tokens", "max_output_tokens"].includes(reason)) throw modelResponseError("limit", reason);
  if (["content_filter", "refusal"].includes(reason)) throw modelResponseError("refused", reason);
  if (payload.type === "response.incomplete" || ["incomplete", "cancelled"].includes(response.status) || reason === "pause_turn") {
    throw modelResponseError("incomplete", reason || response.status);
  }
}
