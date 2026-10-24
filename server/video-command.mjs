import { createHash } from 'node:crypto';

export function parseVideoCommand(text) {
  const value = String(text).trim();
  const prefix = /^[/／](?:视频生成|生成视频)(?=$|[\s，。,:：！!？?])\s*([\s\S]*)$/.exec(value);
  // A child can paste the lesson, then append the command. Quoted examples,
  // cancellations and questions about the command must not start paid work.
  const suffix = !prefix && /[\s，。,:：！!][/／](?:视频生成|生成视频)[。！!]*$/.exec(value);
  if (!prefix && !suffix) return null;
  const instruction = (prefix ? prefix[1] : value.slice(0, suffix.index)).replace(/^[，。,:：！!？?\s]+/, '').trim();
  if (suffix) {
    const tail = instruction.split('\n').at(-1).trim();
    if ((instruction.match(/```/g) || []).length % 2 || /(?:不要|别|不用|无需|取消|停止|禁止)(?:再|自动|帮我|执行|使用|输入|发送|这个|该|指令|命令|\s)*[，。,:：！!]*$/.test(tail)
      || /(?:什么是|解释|介绍|输入|发送|命令|指令|示例|例如|比如|测试命令)[，。,:：\s]*$/.test(tail)) return null;
  }
  const referring = /^(?:请|帮我)?(?:把|将)?(?:这个|当前|刚才的?|上面的?)(?:话题|问题|内容|知识点|故事|讲解)(?:做成|制作成|生成)?(?:一[个段条])?(?:视频)?[。！!？?]*$/;
  return { instruction, currentTopic: !instruction || referring.test(instruction) };
}

// Older releases answered the reversed command with a format correction. Such
// operational turns are not the lesson, even when they have no kind metadata.
function learningTurns(session) {
  let commandTurn = false;
  const turns = [];
  for (const [index, message] of session.messages.entries()) {
    if (message.role === 'user') commandTurn = Boolean(parseVideoCommand(message.content));
    if (commandTurn || message.kind || message.videoCommand || message.videoRetry || message.status === 'error') continue;
    if (['user', 'assistant'].includes(message.role)) turns.push({ index, message });
  }
  return turns;
}

export function videoPlanningSession(session) {
  const messages = learningTurns(session).map(turn => turn.message);
  const lastCommand = session.messages.findLast(message => message.role === 'user' && parseVideoCommand(message.content));
  const command = lastCommand && parseVideoCommand(lastCommand.content);
  // A bare command inherits the lesson. An optional explicit topic is preserved
  // as the student's latest request, without feeding receipts to the planner.
  if (command && !command.currentTopic) messages.push({ role: 'user', content: command.instruction });
  return { ...session, messages };
}

// This is a command, not another tutoring round. Persist a short receipt and
// return the background job immediately, without awaiting the planning model.
export async function queueVideoCommand({ text, session, userId, modelId, agentName, load, save, jobs }) {
  const command = parseVideoCommand(text);
  if (!command) throw Object.assign(new Error('无效的视频指令'), { status: 400 });
  const anchor = learningTurns(session).findLast(turn => turn.message.role === 'assistant')?.index ?? -1;
  if (command.currentTopic && anchor < 0) throw Object.assign(new Error('还没有聊到具体内容呢。先告诉我你想了解什么，再说“/生成视频”就行。'), { status: 400 });
  const key = createHash('sha256').update(JSON.stringify([anchor, command.currentTopic ? '' : command.instruction])).digest('hex');
  // Repeated commands for the same topic refer to the original paid task.
  let index = session.messages.findIndex(message => message.videoCommand?.key === key && message.videoJob);
  if (index >= 0) {
    const id = session.messages[index].videoJob.id;
    // An explicit repeat may retry a failed task. The job manager first checks
    // uncertain remote submissions, and reuses pending/completed work as-is.
    const { videoJob } = await jobs.retry(userId, id, modelId);
    const latest = load(), at = new Date().toISOString();
    const reply = videoJob.status === 'completed'
      ? '视频已经做好了，就在原来的视频消息下面。'
      : '收到，继续处理这个视频，完成后放回原来的消息下面。';
    latest.messages.push({ role: 'user', content: text, at });
    const messageIndex = latest.messages.length;
    latest.messages.push({ role: 'assistant', content: reply, agentName, at, kind: 'video-retry', videoRetry: { jobId: id } });
    latest.status = 'completed'; save(latest);
    return { sessionId: latest.id, messageIndex, text: reply, agentName, hints: latest.hints || 0, resumedVideoJob: videoJob };
  }
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
