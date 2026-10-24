import { runTutor } from './tutor.mjs';
import { extractVideoBrief, buildVideoPrompt, VIDEO_SKILL_INFO } from './video-prompt.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  const request = '根据当前学生问题和已讲内容，完成一条30秒真人知识短片的完整导演方案。先列本题不可遗漏的关键事件与学生点名的情节，核对既有讲解是否有省略，再提炼学习目标和准确事实；按技能中相关史实要求补齐关键转折。设计统一的人物、时代、服装、场景、道具、光线，再用三段各10秒讲清背景、核心事件或原理、结果。每段写明教学目的、起始站位、具体动作、镜头、结束状态、环境声和逐字旁白，不能只说电影质感。旁白采用清晰、稍快的知识短片讲述节奏，短句顺畅衔接，不拖腔、不留长停顿。无字幕、无画面文字，无二次元、动漫或赛璐璐。每段旁白40—55字、全片135—155字（含标点），年份写中文读法；按隐藏视频JSON结构输出，所有字段都填完整。提交前逐项确认关键节点已写入旁白及对应画面，而非仅列在facts中。';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTutor({
      session, modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + (attempt ? '上一次输出未通过完整性、字数或时长检查。请重新组织，确保一个完整JSON标记，包含continuity与每段purpose、start、visual、camera、end、sound、narration。三个分镜各10秒，每段旁白必须40—55字，全片135—155字（含标点）。旁白讲到的新人物、新事件要在对应分镜实际呈现，不能遗漏关键转折。压缩重复修饰，使完整制作提示词不超过3000字，不编造新事实。' : ''),
    });
    const result = extractVideoBrief(raw);
    if (result.brief) {
      try { return { brief: result.brief, prompt: buildVideoPrompt(result.brief), skill: VIDEO_SKILL_INFO }; } catch { /* Repair an overlong brief before any paid submission. */ }
    }
  }
  throw new Error('这次视频讲解没有整理完整，请稍后重试。');
}
