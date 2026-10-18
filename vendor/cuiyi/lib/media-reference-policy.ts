export const MEDIA_REFERENCE_REQUIRED = "MEDIA_REFERENCE_REQUIRED";
export const MEDIA_REFERENCE_REQUIRED_MESSAGE =
  "当前生成要求依赖参考图，但这条任务没有附带任何参考图片。请先在会话中附上参考图，再重新确认生成。";

// Compatibility for proposals/checkpoints produced by an older Runner. New
// actions carry an explicit semantic decision, independent of prompt language.
export function legacyPromptRequiresReferenceImage(prompt: string) {
  const affirmative = prompt
    .replace(/(?:不需要|无需|不依赖|不用|不使用|不要使用|没有|无)(?:任何)?(?:参考图片?|原图)/gu, "")
    .replace(/\b(?:without|no|do not use|don't use)\s+(?:any\s+)?(?:reference|source|original)\s+images?\b/giu, "");
  return /(?:以|基于|依据|根据|使用|采用|保持|保留|复制|沿用)(?:这张|该|所附|上传的|附带的)?(?:参考图片?|原图)|以图生图|\b(?:use|using|based on|preserve|retain|copy|follow)\s+(?:(?:the|an?|attached|uploaded|provided)\s+)*(?:reference|source|original)\s+image\b/iu.test(affirmative);
}
