export type ReviewReasoningEffort = "high" | "max";

export const REVIEW_DEFAULT_REASONING_EFFORT: ReviewReasoningEffort = "max";
export const REVIEW_FALLBACK_REASONING_EFFORT: ReviewReasoningEffort = "high";
export const REVIEW_FIRST_EVENT_TIMEOUT_MS = 90_000;

export type ReviewReasoningPolicy = {
  requestedEffort: ReviewReasoningEffort;
  effectiveEffort: ReviewReasoningEffort;
  automaticallyDowngraded: boolean;
  downgradeReason: string | null;
};

function parsedSettings(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function reviewReasoningPolicy(value: unknown): ReviewReasoningPolicy {
  const settings = parsedSettings(value);
  const requestedEffort = settings.reasoningEffort === "high" ? "high" : "max";
  const effectiveEffort = settings.effectiveReasoningEffort === "high"
    ? "high"
    : requestedEffort;
  return {
    requestedEffort,
    effectiveEffort,
    automaticallyDowngraded: requestedEffort === "max" && effectiveEffort === "high",
    downgradeReason: typeof settings.downgradeReason === "string"
      ? settings.downgradeReason
      : null,
  };
}
