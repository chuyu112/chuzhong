// Kimi Code subscriptions use `k3`; the public Cuiyi catalog ID is `kimi-k3`.
// Keep the video-capable model, its total context window, and per-call output
// budget separate so selecting 1M context never requests 1M output tokens.
export const KIMI_CODE_MODEL_ID = "k3";
export const KIMI_PREVIEW_MODEL_ID = "kimi-for-coding";
export function isKimiCodeModel(modelId) {
  return ["kimi", "kimi-k3", "kimi-k2.8-preview"].includes(modelId);
}
export const KIMI_CONTEXT_WINDOW_TOKENS = 1_048_576;
export const KIMI_MAX_COMPLETION_TOKENS = 100_000;
