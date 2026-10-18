import { Buffer } from "node:buffer";

export const MAXIMUM_DIRECT_MODEL_IMAGES = 9;
export const MAXIMUM_DIRECT_MODEL_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAXIMUM_DIRECT_MODEL_IMAGE_TOTAL_BYTES = 30 * 1024 * 1024;
const DIRECT_MODEL_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isMomentsSemanticReviewJob(job) {
  return /^moments-media:\d{4}-\d{2}-\d{2}:\d+(?::repair-\d+)?:semantic-review(?::retry-\d+)?$/u
    .test(String(job?.id || ""));
}

function normalizedImageMimeType(value) {
  return typeof value === "string"
    ? value.split(";")[0].trim().toLowerCase()
    : "";
}

function skillSourceAssetIds(job) {
  return new Set((Array.isArray(job?.skills) ? job.skills : []).flatMap((skill) =>
    typeof skill?.sourceAssetId === "string" && skill.sourceAssetId
      ? [skill.sourceAssetId]
      : []
  ));
}

export function directModelImageAssets(job) {
  if (
    job?.directImageInput !== true ||
    (job?.agentRole === "review" && !isMomentsSemanticReviewJob(job)) ||
    job?.agentRole === "memory"
  ) return [];
  const skillSources = skillSourceAssetIds(job);
  return (Array.isArray(job?.assets) ? job.assets : [])
    .filter((asset) => !skillSources.has(asset?.id))
    .map((asset, index) => ({ ...asset, inputOrdinal: index + 1 }))
    .filter((asset) => {
      const mimeType = normalizedImageMimeType(asset?.mime_type);
      return asset && typeof asset === "object" &&
        typeof asset.id === "string" && asset.id &&
        mimeType.startsWith("image/") &&
        DIRECT_MODEL_IMAGE_MIME_TYPES.has(mimeType);
    })
    .slice(0, MAXIMUM_DIRECT_MODEL_IMAGES);
}

async function readBoundedBody(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("图片响应超过多模态输入大小上限");
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new Error("图片响应超过多模态输入大小上限");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("image input limit exceeded").catch(() => undefined);
        throw new Error("图片响应超过多模态输入大小上限");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, length);
}

export async function loadDirectModelImages({
  baseUrl,
  runnerToken,
  job,
  signal,
  fetchImpl = fetch,
} = {}) {
  const candidates = directModelImageAssets(job);
  if (!candidates.length) return [];
  const declaredTotalBytes = candidates.reduce((total, asset) => {
    const value = Number(asset?.size_bytes || 0);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  if (declaredTotalBytes > MAXIMUM_DIRECT_MODEL_IMAGE_TOTAL_BYTES) {
    throw new Error("本轮图片总大小超过 30 MiB，请减少图片数量后再发送");
  }
  let totalBytes = 0;
  const images = [];
  for (const asset of candidates) {
    const declaredBytes = Number(asset.size_bytes || 0);
    if (declaredBytes > MAXIMUM_DIRECT_MODEL_IMAGE_BYTES) {
      throw new Error(`图片“${String(asset.name || asset.id)}”超过 10 MiB，不能直接交给当前多模态模型`);
    }
    const response = await fetchImpl(
      `${String(baseUrl || "").replace(/\/$/, "")}/api/internal/jobs/${encodeURIComponent(job.id)}/source-assets/${encodeURIComponent(asset.id)}`,
      {
        headers: {
          authorization: `Bearer ${runnerToken}`,
          "x-job-claim-token": job.claimToken,
        },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`读取图片“${String(asset.name || asset.id)}”失败（HTTP ${response.status}）`);
    }
    const mimeType = normalizedImageMimeType(
      response.headers.get("content-type") || asset.mime_type,
    );
    if (!DIRECT_MODEL_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`资产“${String(asset.name || asset.id)}”不是模型支持的 JPEG、PNG 或 WebP 图片`);
    }
    const bytes = await readBoundedBody(response, MAXIMUM_DIRECT_MODEL_IMAGE_BYTES);
    if (!bytes.length || bytes.length > MAXIMUM_DIRECT_MODEL_IMAGE_BYTES) {
      throw new Error(`图片“${String(asset.name || asset.id)}”为空或超过 10 MiB`);
    }
    totalBytes += bytes.length;
    if (totalBytes > MAXIMUM_DIRECT_MODEL_IMAGE_TOTAL_BYTES) {
      throw new Error("本轮图片总大小超过 30 MiB，请减少图片数量后再发送");
    }
    const base64 = bytes.toString("base64");
    images.push({
      assetId: asset.id,
      name: String(asset.name || asset.id),
      ordinal: Number(asset.inputOrdinal),
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    });
  }
  return images;
}
