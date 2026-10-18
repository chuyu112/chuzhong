// Audited 2026-10-12 against the signed-in Flova picker, its released model
// knowledge, and live LibTV model schemas. See docs/media-provider-mapping.md.
// Match native execution keys, never editable display labels or similar names.
type MediaModel = { id: string; kind: string; execution: { channel: string; modelKey: string } };
type Settings = Record<string, unknown>;
export const FLOVA_SUNBURST_NAME = "Flova Image 2.5 Sunburst";
type Mapping = { modelKey: string; version?: string; promptSuffix?: string };
const libTvMappings: Record<string, Mapping> = {
  "lib-image-2": { modelKey: "Flova Image 2" },
  "lib-image-2.5-s": { modelKey: FLOVA_SUNBURST_NAME },
  "nebula-ultra": { modelKey: "Flova Nano Pro", version: "Nano Banana Pro (Gemini 3 Pro Image)" },
  "doubao-seedream-5-0-pro": { modelKey: "Seedream 5.0 Pro" },
  "mj-v8.2": { modelKey: "MJ", version: "Midjourney 8.2", promptSuffix: "--v 8.2" },
  "mj-v7": { modelKey: "MJ", version: "Midjourney 7", promptSuffix: "--v 7" },
  "star-video2-mini": { modelKey: "Seedance 2.0 Mini" },
  "star-video2": { modelKey: "Seedance 2.0" },
  "star-video2.5": { modelKey: "Seedance 2.5" },
  "kling-v3-omni": { modelKey: "Kling 3.0 Omni" },
  "MiniMax-Hailuo-H3": { modelKey: "MiniMax H3" },
  "mureka-8": { modelKey: "Mureka", version: "Mureka 8" },
  "speech-2.8-hd": { modelKey: "MiniMax", version: "MiniMax Speech 2.8 HD" },
  "vocal-v3": { modelKey: "Eleven", version: "ElevenLabs v3" },
  "seed-audio-1.0": { modelKey: "Seed-Audio 1.0", version: "Seed Audio 1.0" },
};
const nativeAliases: Record<string, Mapping | null> = {
  "GPT Image 2.5 Sunburst": { modelKey: FLOVA_SUNBURST_NAME },
  "Image 2.5 Sunburst": { modelKey: FLOVA_SUNBURST_NAME },
  "Suno": { modelKey: "S Music", version: "Suno 5" },
  "S Music": { modelKey: "S Music", version: "Suno 5" },
  "Seed-Audio 1.0": { modelKey: "Seed-Audio 1.0", version: "Seed Audio 1.0" },
  // Different models, not aliases. Preserve the historical ID but prevent new
  // dispatches until an actual provider route is configured.
  "Doubao TTS 2.0": null,
};
export function flovaMappingFor(model: MediaModel): Mapping | null {
  if (model.execution.channel === "libtv") return libTvMappings[model.execution.modelKey] || null;
  if (model.execution.channel !== "flova-ai") return null;
  if (Object.hasOwn(nativeAliases, model.execution.modelKey)) return nativeAliases[model.execution.modelKey];
  return { modelKey: model.execution.modelKey };
}

export function libTvMappingFor(model: MediaModel): Mapping | null {
  if (model.execution.channel === "libtv") return { modelKey: model.execution.modelKey };
  if (model.execution.channel !== "flova-ai") return null;
  const keys: Record<string, string> = { "Seed-Audio 1.0": "seed-audio-1.0", "Seed Audio 1.0": "seed-audio-1.0", "Eleven": "vocal-v3" };
  return keys[model.execution.modelKey] ? { modelKey: keys[model.execution.modelKey] } : null;
}

function record(value: unknown): Settings {
  if (typeof value === "string") { try { return record(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};
}

// A provider alias does not imply that every parameter value is interchangeable.
// Non-matching configurations stay on their native provider; never round, clamp
// or silently replace a chosen variant at the dispatch boundary.
export function flovaSupportsSettings(model: MediaModel, value?: unknown) {
  const mapping = flovaMappingFor(model);
  if (!mapping) return false;
  const settings = record(value);
  const key = model.execution.modelKey;
  if ([FLOVA_SUNBURST_NAME, "Flova Image 2"].includes(mapping.modelKey)) {
    if (settings.ratio && !["16:9", "9:16", "4:3", "3:4"].includes(String(settings.ratio))) return false;
    if (settings.quality && settings.quality !== "medium") return false;
  }
  if (["star-video2", "star-video2-mini"].includes(key) && settings.resolution === "480p") return false;
  if (key === "star-video2-mini" && settings.resolution && settings.resolution !== "720p") return false;
  if (["nebula-ultra", "star-video2", "star-video2-mini", "star-video2.5"].includes(key)
    && ["auto", "adaptive"].includes(String(settings.ratio))) return false;
  return true;
}

export function flovaExecutionSettings(model: MediaModel, value?: unknown) {
  if (!flovaSupportsSettings(model, value)) throw new Error("MEDIA_MODEL_PARAMETERS_UNSUPPORTED");
  const settings = { ...record(value) };
  const key = model.execution.modelKey;
  if (["nebula-ultra", "doubao-seedream-5-0-pro"].includes(key) && settings.quality) {
    settings.resolution = settings.quality;
    delete settings.quality;
  }
  if (key === "kling-v3-omni" && settings.quality) {
    settings.resolution = settings.quality === "high" ? "1080p" : "720p";
    delete settings.quality;
  }
  if (key === "MiniMax-Hailuo-H3" && typeof settings.resolution === "string") settings.resolution = settings.resolution.toLowerCase();
  // Flova exposes its standard image generation without LibTV's quality tier
  // selector. Only the normal/default tier is eligible for this route.
  if (["lib-image-2", "lib-image-2.5-s"].includes(key)) delete settings.quality;
  return settings;
}

export function flovaModelInstruction(model: MediaModel) {
  const mapping = flovaMappingFor(model);
  if (!mapping) throw new Error("MEDIA_MODEL_UNAVAILABLE");
  return [
    mapping.version ? `The exact underlying model/version is ${mapping.version}; the provider picker calls it ${mapping.modelKey}.` : "",
    mapping.promptSuffix ? `Use the Midjourney tool and append ${mapping.promptSuffix} to the image prompt (after style references). Never use another --v or --niji version.` : "",
  ].filter(Boolean).join("\n");
}
