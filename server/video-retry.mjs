// Conversational retries only resume an existing slash-command task. Ordinary
// learning questions and new video requests never create a task through here.
export function parseVideoRetry(text, models = []) {
  const normalize = value => String(value).toLowerCase().replace(/[\s，。！？、,.!?：:]/g, '');
  let value = normalize(text);
  value = value.replace(/^(?:小直)?(?:请|麻烦你|帮我|帮忙)*/, '').replace(/(?:吧|啊|呀|谢谢)+$/, '');
  let modelId = null;
  const named = models.map(model => ({ model, alias: [model.id, model.label].filter(Boolean).map(normalize) }))
    .flatMap(({ model, alias }) => alias.map(name => ({ model, name }))).sort((a, b) => b.name.length - a.name.length);
  const match = named.find(({ name }) => value.includes(name)) || models.map(model => ({ model, name: model.id.split('-')[0].toLowerCase() })).find(({ name }) => name.length > 2 && value.includes(name));
  if (match) { modelId = match.model.id; value = value.replace(match.name, '指定模型'); }
  const explicitVideo = /视频|短片/.test(value);
  value = value.replace(/^(?:这个|刚才的?|上一个|刚刚的)?(?:视频|短片)(?:失败了|没生成成功|没生成|没出来)?/, '')
    .replace(/(?:这个|刚才的?)?(?:视频|短片)$/, '');
  if (/^(?:重试(?:一下)?|再试(?:一次|一下|试)|重新生成(?:一次|一下)?)$/.test(value)) return { changeModel: false, modelId, explicitVideo };
  if (/^(?:换(?:成|个|一个)?(?:模型|指定模型)|用(?:另一个模型|指定模型))(?:重试(?:一下)?|再试(?:一次|一下|试)|试(?:一次|一下|试)|生成(?:一次)?|重新生成)$/.test(value)) return { changeModel: true, modelId, explicitVideo };
  return null;
}

export async function replyToVideoRetry({ text, session, userId, agentName, models, jobs, load, save }) {
  const intent = parseVideoRetry(text, models);
  if (!intent) return null;
  const lastAssistant = session.messages.findLast(message => message.role === 'assistant');
  const anchor = intent.explicitVideo
    ? session.messages.findLast(message => message.videoCommand && message.videoJob)
    : lastAssistant?.videoCommand ? lastAssistant : lastAssistant?.videoRetry
      ? session.messages.find(message => message.videoJob?.id === lastAssistant.videoRetry.jobId) : null;
  if (!anchor && !intent.explicitVideo) return null;
  let job = anchor && jobs.get(userId, anchor.videoJob.id), resumedVideoJob = null, reply;
  if (!job) reply = '这里还没有可重试的视频任务。先聊一个话题，再说“/视频生成”，我就能开始制作。';
  else {
    const configured = models.filter(model => model.configured);
    const original = configured.find(model => model.id === job.modelId);
    const model = job.status !== 'failed' ? original || { id: job.modelId, label: '原来的模型' } : intent.modelId ? configured.find(model => model.id === intent.modelId) : intent.changeModel
      ? configured.find(model => model.id.split('-')[0] !== job.modelId.split('-')[0]) || configured.find(model => model.id !== job.modelId)
      : original;
    if (!model) reply = intent.changeModel ? '暂时没有可用的其他讲解模型。你可以说“重试”，让我用原来的模型再试一次。' : '原来的讲解模型暂时不可用。你可以说“换个模型重试”。';
    else {
      const before = job.status;
      try {
        const result = await jobs.retry(userId, job.id, model.id);
        resumedVideoJob = result.videoJob;
        job = jobs.get(userId, job.id);
        reply = result.videoJob.status === 'completed' ? '视频已经做好了，就在原来的视频消息下面，可以直接播放。'
          : before === 'pending' || job.modelId !== model.id || job.stage === 'recovering'
            ? '原来的视频任务还在处理，我会接着获取结果，完成后放回原来的消息下面。'
            : intent.changeModel ? `好，我换用 ${model.label} 整理脚本，再试一次。做好后仍放在原来的消息下面。`
              : '好，我再试一次。做好后仍放在原来的视频消息下面，你可以继续聊。';
      } catch (error) { reply = error.status ? error.message : '这次没能启动重试，稍后再跟我说一声“重试”就好。'; }
    }
  }
  // Inspecting a remote task can take time. Merge with the latest durable
  // session so completed images/videos and new messages cannot be overwritten.
  const latest = load(), at = new Date().toISOString();
  latest.messages.push({ role: 'user', content: text, at });
  const messageIndex = latest.messages.length;
  latest.messages.push({ role: 'assistant', content: reply, agentName, at, kind: 'video-retry', ...(job ? { videoRetry: { jobId: job.id } } : {}) });
  latest.status = 'completed'; save(latest);
  return { sessionId: latest.id, messageIndex, text: reply, agentName, hints: latest.hints || 0, resumedVideoJob };
}
