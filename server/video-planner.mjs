import { runTutor } from './tutor.mjs';
import { inspectVideoBrief, buildVideoPrompt, validateEnglishReview, VIDEO_SKILL_INFO, VIDEO_BRIEF_MAX_CHARACTERS } from './video-prompt.mjs';
import { videoPlanningSession } from './video-command.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  session = videoPlanningSession(session);
  const request = '综合最近多轮聊天整理正在延续的学习主线，不把最后一个词义、纠错或操作回执当作整个主题。学生明确提供的对话或关键事件优先保留；先评估在正常语速下讲清内容需要多少秒，再安排镜头。英语使用english_roleplay、teachingVersion:3，两位英语母语外国真人正常语速完整演对话一次，然后稍慢讲清要点，把关键句或短语再说一次；先解释再复述，复述只针对要点，有余量才增加不同情境的新例子。不能重演整段对话、强制逐词慢放、拖长发音、拉大停顿或照读重复内容凑30秒；需要强调的发音只略微清楚地读。按内容设计2—4段scenes，第一段stage为normal，第二段必须为breakdown，先解释再复述要点；后续可用breakdown或example，所有seconds合计30；每句英文都有中文translation，重点focus对应chunks词义、用法与物体动作。全片英文台词以约66—74词为参考，先数词估时，再分配原对话、重点解释和新例子；正常台词约150—170词/分钟，delivery默认为natural，breakdown全部用clear且约145词/分钟，解释台词与要点复述用同一个focus；复述台词独立成行，原样来自首演。不要只因旧模板要求重复就重复；内容多就省掉新例子，内容少就补有教学价值的新例子。其他学科用knowledge，三段各10秒，中文旁白每段40—55字、总计135—155字，保留关键事实、转折与学生点名的情节，讲清因果且无字幕。所有模式都需完整但精简的角色、场景、动作、摄影和衔接，真人电影质感，无动漫或赛璐璐，30秒480p横屏。只输出一个完整learning-video隐藏JSON，不把制作说明写进台词。';
  let previousRaw = '', issue = '';
  const subtitleRequest = '英语字幕由服务器依据成片实际发音对齐，不按预估时间硬压字幕。中文只用于字幕，不读进英文台词；台词逐字正确，不自行生成画面文字。保留正常语流和清楚发音，讲解可由原来的两位角色完成，不能引入第三位解说。';
  const diagnostics = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try { raw = await runTutor({
      session: previousRaw ? { ...session, messages: [...session.messages, { role: 'assistant', content: previousRaw.slice(0, VIDEO_BRIEF_MAX_CHARACTERS + 64) }] } : session,
      modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + subtitleRequest + '先估算内容再分配时间，别为了三段结构删掉主线或重复全文。制作提示词不超过3000字，精简重复的镜头形容。' + (attempt ? `上一次具体校验问题：${issue}。修复这个问题并核对其余字段，只输出一个完整learning-video标记。英语必须teachingVersion:3，按内容安排normal、必需的breakdown讲解与关键表达复述、可选的新example，不使用slow阶段。knowledge保持三段10秒及原旁白字数要求。` : ''),
    }); } catch (error) {
      // Only fixed labels and numeric HTTP codes are persisted, never provider bodies.
      const causes = { MODEL_RESPONSE_LIMIT: '脚本输出达到长度上限，内容未写完', MODEL_RESPONSE_EMPTY: '脚本文案模型返回空内容', MODEL_RESPONSE_UPSTREAM: '脚本文案模型接口异常', MODEL_RESPONSE_INCOMPLETE: '脚本文案模型回复中断', MODEL_RESPONSE_REFUSED: '脚本文案模型拒绝当前请求' };
      const timedOut = signal?.aborted || error?.name === 'TimeoutError';
      const providerStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
      diagnostics.push({ attempt: attempt + 1, issue: timedOut ? '整理脚本超时' : causes[error?.code] || (providerStatus ? `脚本文案接口请求失败（HTTP ${providerStatus}）` : '脚本文案模型调用失败'), ...(Object.hasOwn(causes, error?.code) ? { causeCode: error.code } : {}), ...(providerStatus ? { providerStatus } : {}) });
      throw Object.assign(new Error('视频文案模型调用未完成'), { code: timedOut ? 'VIDEO_PLANNING_TIMEOUT' : error?.code === 'MODEL_RESPONSE_LIMIT' ? 'VIDEO_SCRIPT_OUTPUT_LIMIT' : 'VIDEO_MODEL_REQUEST_FAILED', diagnostics });
    }
    const result = inspectVideoBrief(raw, { scheduleDraft: true });
    previousRaw = raw; issue = result.issue;
    if (result.brief?.mode === 'english_roleplay' && result.brief.teachingVersion !== 3) { issue = '新英语脚本必须使用teachingVersion:3，先估内容时长，完整对话只演一次，随后稍慢讲清并复述要点，余量用新例子，不重演整段对话'; diagnostics.push({ attempt: attempt + 1, issue }); continue; }
    if (result.brief) {
      try { validateEnglishReview(result.brief); return { brief: result.brief, prompt: buildVideoPrompt(result.brief), skill: VIDEO_SKILL_INFO }; } catch (error) { issue = error.message; }
    }
    diagnostics.push({ attempt: attempt + 1, issue });
  }
  throw Object.assign(new Error('这次视频讲解没有整理完整，请稍后重试。'), { code: 'VIDEO_BRIEF_INVALID', diagnostics });
}
