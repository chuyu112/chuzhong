import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Durable state is stored before any paid submission. Recovery only inspects
// an already submitted node. It never repeats --run after an unknown outcome.
export function createVideoJobs({ read, write, provider, plan, data, canGenerate = () => true, pollMs = 5000, waitMs = 10 * 60 * 1000 }) {
  const active = new Set();
  const jobKey = (userId, id) => `u:${userId}:video-job:${id}`;
  const sessionKey = (job) => `u:${job.userId}:session:${job.sessionId}`;
  const get = (userId, id) => read(jobKey(userId, id), null);
  function update(job, changes) {
    Object.assign(job, changes);
    write(jobKey(job.userId, job.id), job);
    const session = read(sessionKey(job), null), message = session?.messages?.[job.messageIndex];
    if (message?.videoJob?.id === job.id) {
      message.videoJob = { id: job.id, status: job.status };
      if (job.error) message.videoError = job.error;
      if (job.ref) message.generatedVideoRef = job.ref;
      write(sessionKey(job), session);
    }
  }
  function start(userId, id) {
    if (!canGenerate(userId) || active.has(id)) return;
    const job = get(userId, id);
    if (!job || job.status !== 'pending') return;
    active.add(id);
    void (async () => {
      try {
        const session = read(sessionKey(job), null);
        if (!session || session.messages?.[job.messageIndex]?.videoJob?.id !== id) throw new Error('missing message');
        if (!job.prompt) {
          const planned = await plan({ ...session, messages: session.messages.slice(0, job.messageIndex + 1) }, job);
          update(job, { prompt: planned.prompt, title: planned.brief.title });
        }
        if (!job.projectId) update(job, { projectId: await provider.createProject(id) });
        if (!job.nodeId) update(job, { nodeId: await provider.createNode(job.projectId, id, job.prompt) });
        if (!job.submittedAt) {
          update(job, { submittedAt: Date.now() });
          // CLI may wait for completion. Polling is independent, so this doesn't
          // hold the chat response or prevent recovery after process restart.
          void provider.submit(job.projectId, job.nodeId).catch(() => {});
        }
        const watchStartedAt = Date.now();
        while (Date.now() - watchStartedAt < waitMs) {
          let status;
          try { status = await provider.inspect(job.projectId, job.nodeId); } catch { await delay(pollMs); continue; }
          if (status.awaitingSubmission && Date.now() - job.submittedAt > 90000) throw new Error('submission not confirmed');
          if (status.status === 'completed') {
            const result = await provider.download(job.projectId, job.nodeId, status.url);
            const filename = createHash('sha256').update(result.buffer).digest('hex');
            const folder = resolve(data, 'videos', userId); mkdirSync(folder, { recursive: true });
            writeFileSync(resolve(folder, filename), result.buffer, { mode: 0o600 });
            update(job, { status: 'completed', completedAt: new Date().toISOString(), ref: { filename, mimeType: 'video/mp4', duration: result.duration, width: result.width, height: result.height } });
            break;
          }
          if (status.status === 'failed') throw new Error('provider failed');
          await delay(pollMs);
        }
        // A slow provider remains pending; reopening/polling resumes this same
        // task instead of generating or charging again.
      } catch {
        update(job, { status: 'failed', error: '这次视频暂时没完成，讲解文字已保留。' });
      } finally { active.delete(id); }
    })();
  }
  return {
    get, start,
    enqueue(userId, sessionId, messageIndex, modelId) {
      if (!canGenerate(userId)) throw Object.assign(new Error('视频功能暂未向此账号开放'), { status: 403 });
      const session = read(`u:${userId}:session:${sessionId}`, null), message = session?.messages?.[messageIndex];
      if (!message || message.role !== 'assistant' || message.kind || message.status === 'error') throw Object.assign(new Error('请先完成一段知识讲解'), { status: 400 });
      // Completed, pending and uncertain failures all keep their original task.
      if (message.videoJob) { start(userId, message.videoJob.id); return message.videoJob; }
      if (!provider.configured) throw Object.assign(new Error('视频生成暂未配置'), { status: 503 });
      const job = { id: randomUUID(), userId, sessionId, messageIndex, modelId, status: 'pending', createdAt: new Date().toISOString() };
      message.videoJob = { id: job.id, status: job.status }; write(sessionKey(job), session);
      write(jobKey(userId, job.id), job); start(userId, job.id);
      return message.videoJob;
    },
    recover(rows) { for (const row of rows) { const job = JSON.parse(row.body); if (job.status === 'pending') start(job.userId, job.id); } },
  };
}
