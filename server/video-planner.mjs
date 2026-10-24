import { runTutor } from './tutor.mjs';
import { extractVideoBrief, buildVideoPrompt } from './video-prompt.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  const request = '请把当前对话中学生的问题和已经讲过的内容，整理为一条30秒学习视频。聚焦当前卡点，保持教学进度。先核对知识事实，再按隐藏视频标记格式给出三段各10秒的分镜，每段旁白不超过45字。使用真人实拍质感、真实人物与场景，无字幕、无画面文字，不用二次元、动漫、插画或赛璐璐；知识点通过动作实物与中文画外音说明。';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTutor({
      session, modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + (attempt ? '上一次输出未通过格式或时长检查。请重新组织，确保只有一个完整JSON标记、三个分镜、每段10秒且全片旁白不超过130字。不要添加新事实。' : ''),
    });
    const result = extractVideoBrief(raw);
    if (result.brief) {
      try { return { brief: result.brief, prompt: buildVideoPrompt(result.brief) }; } catch { /* Repair an overlong brief before any paid submission. */ }
    }
  }
  throw new Error('这次视频讲解没有整理完整，请稍后重试。');
}
