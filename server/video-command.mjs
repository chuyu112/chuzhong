import { createHash } from 'node:crypto';

export function parseVideoCommand(text) {
  const match = /^[/／]视频生成(?=$|[\s，。,:：！!？?])\s*([\s\S]*)$/.exec(String(text).trim());
  if (!match) return null;
  const instruction = match[1].replace(/^[，。,:：！!？?\s]+/, '').trim();
  const referring = /^(?:请|帮我)?(?:把|将)?(?:这个|当前|刚才的?|上面的?)(?:话题|问题|内容|知识点|故事|讲解)(?:做成|制作成|生成)?(?:一[个段条])?(?:视频)?[。！!？?]*$/;
  return { instruction, currentTopic: !instruction || referring.test(instruction) };
}

// This is a command, not another tutoring round. Persist a short receipt and
// return the background job immediately, without awaiting the planning model.
export function queueVideoCommand({ text, session, userId, modelId, agentName, save, jobs }) {
  const command = parseVideoCommand(text);
  if (!command) throw Object.assign(new Error('无效的视频指令'), { status: 400 });
  let anchor = -1;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message.role === 'assistant' && !message.kind && !message.videoCommand && message.status !== 'error') { anchor = i; break; }
  }
  if (command.currentTopic && anchor < 0) throw Object.assign(new Error('先聊一个话题，或输入“/视频生成 你想了解的主题”。'), { status: 400 });
  const key = createHash('sha256').update(JSON.stringify([anchor, command.currentTopic ? '' : command.instruction])).digest('hex');
  // Repeated commands for the same topic refer to the original paid task.
  let index = session.messages.findIndex(message => message.videoCommand?.key === key && message.videoJob);
  if (index < 0) {
    const at = new Date().toISOString();
    session.messages.push({ role: 'user', content: text, at });
    index = session.messages.length;
    session.messages.push({ role: 'assistant', content: '收到，我会把这个话题做成一段视频，完成后放在这里。你可以继续问。', agentName, at, videoCommand: { key, anchor } });
    session.status = 'completed'; save(session);
  }
  const videoJob = jobs.enqueue(userId, session.id, index, modelId);
  return { sessionId: session.id, messageIndex: index, text: session.messages[index].content, agentName, hints: session.hints || 0, videoJob,
    videoUrl: videoJob.status === 'completed' ? `/api/sessions/${session.id}/videos/${index}` : null };
}
