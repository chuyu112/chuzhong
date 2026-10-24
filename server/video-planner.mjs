import { runTutor } from './tutor.mjs';
import { extractVideoBrief, buildVideoPrompt, VIDEO_SKILL_INFO } from './video-prompt.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  const request = '根据当前学生问题和已讲内容，完成一条30秒真人知识短片的完整导演方案。先提炼学习目标与已知事实，设计统一的人物、时代、服装、场景、道具、光线，再用三段各10秒讲清背景、核心事件或原理、结果。每段写明教学目的、起始站位、具体动作、镜头、结束状态、环境声和逐字旁白，不能只说电影质感。无字幕、无画面文字，无二次元、动漫或赛璐璐。旁白每段不超过45字、全片不超过130字；按隐藏视频JSON结构输出，所有字段都填完整。';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTutor({
      session, modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + (attempt ? '上一次输出未通过完整性、字数或时长检查。请重新组织，确保一个完整JSON标记，包含continuity与每段purpose、start、visual、camera、end、sound、narration。三个分镜各10秒，每段旁白必须28—45字，全片不超过130字。旁白讲到的新人物、新事件要在对应分镜实际呈现。压缩修饰，使完整制作提示词不超过3000字，不要添加新事实。' : ''),
    });
    const result = extractVideoBrief(raw);
    if (result.brief) {
      try { return { brief: result.brief, prompt: buildVideoPrompt(result.brief), skill: VIDEO_SKILL_INFO }; } catch { /* Repair an overlong brief before any paid submission. */ }
    }
  }
  throw new Error('这次视频讲解没有整理完整，请稍后重试。');
}
