import { runTutor } from './tutor.mjs';
import { inspectVideoBrief, buildVideoPrompt, VIDEO_SKILL_INFO, VIDEO_BRIEF_MAX_CHARACTERS } from './video-prompt.mjs';
import { videoPlanningSession } from './video-command.mjs';

// This stage is read-only with respect to the student's conversation. The caller
// persists the approved brief before submitting exactly one provider job.
export async function planLearningVideo({ session, modelId, environment, memory, agentName, signal, runModelOverride }) {
  session = videoPlanningSession(session);
  const request = '先综合最近多轮聊天，整理仍在延续的学习主线：学生原本想学会什么，已经讲到哪里，哪些追问补充了这条主线，哪些困惑还没解决。不能只取最后一句或把最后一个小问题当成整个主题。词义解释、格式纠正、任务回执和偶发岔题属于分支；有助理解的词义或概念追问并入主线，其余操作分支不进入视频。只有学生明确另给主题，或对话已经持续转入另一个实质学习目标时，才切换主线；不能因为出现了一个新名词就换题，也不能把教师尚未被学生选择的替换练习当成新主题。把整理出的主线写入goal，必要内容写入facts，再据此设计完整分镜，不要求孩子重复主题。根据学生当前学习目标选择分镜模式，不按无关旧话题决定：英语表达、单词、语法或听说问题（包括中文问点餐怎么说）必须用english_roleplay，两位英语母语外国真人，标准美式发音；先正常口语速度完整演一遍，再慢速原样重演，最后一个词一个词分析。teachingVersion为2，三镜stage依次normal、slow、word_by_word，seconds依次6、9、15。前两镜角色、台词和顺序完全一致，首演约140—180词/分钟，慢演约90—110词/分钟且每句发音时间至少增加25%。chunks按完整对话顺序逐词列phrase、meaning、usage、action，覆盖回应与重复词；第三镜每条dialogue只读一个对应词，text和focus均为该词，至少留0.8秒。选能自然说完的简短表达，不能靠赶读塞满。输出targetSentence、cast、chunks及带时间窗的dialogue，服务器添加准确英文字幕，逐词段同时显示中文意思和句中作用；不用中文旁白。其他学科用knowledge：先列不可遗漏的事实、事件与学生点名的情节，补全有把握的关键转折，三段各十秒讲清因果；每段中文旁白40—55字、总计135—155字，语速清晰稍快，无字幕。两种模式都写完整人物与场景统一设定、每镜教学目的、起始状态、动作、镜头、衔接、环境声，真人电影质感、无动漫或赛璐璐，30秒480p横屏，最终提示词不超过3000字。只输出一个完整的learning-video隐藏JSON标记；不要把制作指令写进台词。';
  let previousRaw = '', issue = '';
  const subtitleRequest = '仅对english_roleplay模式：正常语速与慢速重演的每条dialogue还必须有translation字段，写该句准确、自然的中文翻译；两遍逐句相同。成片从第一句起显示中英双语字幕，逐词段继续显示中文词义和用法；中文只用于字幕后期，不读进英文台词。';
  const diagnostics = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try { raw = await runTutor({
      session: previousRaw ? { ...session, messages: [...session.messages, { role: 'assistant', content: previousRaw.slice(0, VIDEO_BRIEF_MAX_CHARACTERS + 64) }] } : session,
      modelId, environment, memory, agentName, signal, runModelOverride,
      generateVideo: true,
      text: request + subtitleRequest + '脚本务必精简：英语整段双方对话优先合计6—10词，最多16词，不把整篇聊天塞入30秒。人物外貌与音色各用一句，场景、动作和镜头用短句，不重复电影化修饰。中文翻译和逐词解释完整保留。服务端按词数校准发音时间，观察停顿另排，不用拖长发音填满镜头。' + (attempt ? `上一次分镜的具体校验问题：${issue}。请修复上方草稿的这个问题，并核对其余字段，保留主题与准确事实，只输出修复后的一个完整learning-video标记。保留正确模式：knowledge三镜各10秒，每段中文旁白40—55字、全片135—155字；english_roleplay保持teachingVersion:2及normal→slow→word_by_word顺序，三镜6、9、15秒，修复dialogue、时间窗、逐词释义和用法，不填中文旁白。压缩重复修饰，使完整制作提示词不超过3000字。` : ''),
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
    if (result.brief) {
      try { return { brief: result.brief, prompt: buildVideoPrompt(result.brief), skill: VIDEO_SKILL_INFO }; } catch (error) { issue = error.message; }
    }
    diagnostics.push({ attempt: attempt + 1, issue });
  }
  throw Object.assign(new Error('这次视频讲解没有整理完整，请稍后重试。'), { code: 'VIDEO_BRIEF_INVALID', diagnostics });
}
