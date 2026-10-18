import { posterArtifact } from "../lib/poster-artifact.ts";
import { modelResponseError } from "./model-response-status.mjs";

export function isPosterCreatorJob(job) {
  return job?.agentRole === "creator" && job.textIntent === "poster" && !job.channelId;
}

export function posterGenerationTimeoutMs(env = {}) {
  const value = Number(env.DIRECTOR_POSTER_GENERATION_TIMEOUT_MS);
  return Math.min(480_000, Math.max(10_000,
    Number.isFinite(value) && value > 0 ? value : 480_000));
}

/** One initial workflow window, then one full HTML window after server acceptance.
 * Repeated tool calls/steering cannot keep extending the job. The lease stays
 * independent so timeout/cancellation can still persist a terminal result.
 */
export function createPosterTurnBudget(job, leaseSignal, initialTimeoutMs, env = {}, timers = {}) {
  if (!isPosterCreatorJob(job)) return null;
  const schedule = timers.setTimeout || setTimeout;
  const cancel = timers.clearTimeout || clearTimeout;
  const controller = new AbortController();
  let timer;
  let generationStarted = false;
  let artifactExpected = false;
  let disposed = false;
  const arm = milliseconds => {
    cancel(timer);
    timer = schedule(() => controller.abort(new DOMException("海报执行超时", "TimeoutError")), milliseconds);
    timer?.unref?.();
  };
  const abortFromLease = () => {
    cancel(timer);
    controller.abort(leaseSignal.reason);
  };
  if (leaseSignal?.aborted) abortFromLease();
  else {
    leaseSignal?.addEventListener("abort", abortFromLease, { once: true });
    arm(initialTimeoutMs);
  }
  return {
    signal: controller.signal,
    beginGeneration(input, result) {
      if (disposed || controller.signal.aborted || result?.accepted !== true ||
          result.state?.canGenerate !== true ||
          !["generate", "autonomous-complete", "direct-answer"].includes(input?.action)) return false;
      if (["generate", "autonomous-complete"].includes(input.action)) artifactExpected = true;
      if (generationStarted) return false;
      generationStarted = true;
      arm(posterGenerationTimeoutMs(env));
      return true;
    },
    assertResult(output) {
      if (artifactExpected && !posterArtifact(output)) throw modelResponseError("incomplete");
    },
    dispose() {
      disposed = true;
      cancel(timer);
      leaseSignal?.removeEventListener("abort", abortFromLease);
    },
  };
}
