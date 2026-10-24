import { runTutor } from './tutor.mjs';
import { inspectVideoBrief, buildVideoPrompt, VIDEO_SKILL_INFO } from './video-prompt.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  const request = '根据学生当前学习目标选择分镜模式，不按无关旧话题决定：英语表达、单词、语法或听说问题（包括中文问点餐怎么说）必须用english_roleplay，两位英语母语外国真人，标准美式发音、语速较慢；先拆解准确的目标句，把每个短语与物体或动作逐一对应，最后十秒完整演一遍双人对话。输出targetSentence、cast、chunks及带时间窗的dialogue，服务器逐字添加英文字幕；不用中文旁白。其他学科用knowledge：先列不可遗漏的事实、事件与学生点名的情节，补全有把握的关键转折，三段十秒讲清因果；每段中文旁白40—55字、总计135—155字，语速清晰稍快，无字幕。两种模式都写完整人物与场景统一设定、每镜教学目的、起始状态、动作、镜头、衔接、环境声，真人电影质感、无动漫或赛璐璐，30秒480p横屏，最终提示词不超过3000字。只输出一个完整的learning-video隐藏JSON标记；不要把制作指令写进台词。';
  let previousRaw = '', issue = '';
  const diagnostics = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try { raw = await runTutor({
      session: previousRaw ? { ...session, messages: [...session.messages, { role: 'assistant', content: previousRaw.slice(0, 16000) }] } : session,
      modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + (attempt ? `上一次分镜的具体校验问题：${issue}。请修复上方草稿的这个问题，并核对其余字段，保留主题与准确事实，只输出修复后的一个完整learning-video标记。保留正确模式：knowledge每段中文旁白40—55字、全片135—155字；english_roleplay按英语规则修复dialogue、时间窗、词义与动作对应，不填中文旁白。三个分镜各10秒；压缩重复修饰，使完整制作提示词不超过3000字。` : ''),
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
