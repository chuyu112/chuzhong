import { runTutor } from './tutor.mjs';
import { inspectVideoBrief, buildVideoPrompt, VIDEO_SKILL_INFO } from './video-prompt.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  const request = '根据当前学生问题和已讲内容，完成一条30秒真人知识短片的完整导演方案。先列本题不可遗漏的关键事件与学生点名的情节，核对既有讲解是否有省略，再提炼学习目标和准确事实；按技能中相关史实要求补齐关键转折。设计统一的人物、时代、服装、场景、道具、光线，再用三段各10秒讲清背景、核心事件或原理、结果。每段写明教学目的、起始站位、具体动作、镜头、结束状态、环境声和逐字旁白，不能只说电影质感。旁白采用清晰、稍快的知识短片讲述节奏，短句顺畅衔接，不拖腔、不留长停顿。无字幕、无画面文字，无二次元、动漫或赛璐璐。每段旁白40—55字、全片135—155字（含标点），年份写中文读法；按隐藏视频JSON结构输出，所有字段都填完整。提交前逐项确认关键节点已写入旁白及对应画面，而非仅列在facts中。';
  let previousRaw = '', issue = '';
  const diagnostics = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try { raw = await runTutor({
      session: previousRaw ? { ...session, messages: [...session.messages, { role: 'assistant', content: previousRaw.slice(0, 16000) }] } : session,
      modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + (attempt ? `上一次分镜的具体校验问题：${issue}。请修复上方草稿的这个问题，并核对其余字段，保留主题与准确事实，只输出修复后的一个完整learning-video标记。三个分镜各10秒，每段旁白40—55字，全片135—155字；压缩重复修饰，使完整制作提示词不超过3000字。` : ''),
    }); } catch {
      throw Object.assign(new Error('视频文案模型调用未完成'), { code: signal?.aborted ? 'VIDEO_PLANNING_TIMEOUT' : 'VIDEO_MODEL_REQUEST_FAILED', diagnostics });
    }
    const result = inspectVideoBrief(raw);
    previousRaw = raw; issue = result.issue;
    if (result.brief) {
      try { return { brief: result.brief, prompt: buildVideoPrompt(result.brief), skill: VIDEO_SKILL_INFO }; } catch (error) { issue = error.message; }
    }
    diagnostics.push({ attempt: attempt + 1, issue });
  }
  throw Object.assign(new Error('这次视频讲解没有整理完整，请稍后重试。'), { code: 'VIDEO_BRIEF_INVALID', diagnostics });
}
