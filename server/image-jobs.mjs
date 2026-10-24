import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const failure = '这次配图暂时没生成出来，讲解文字已经保留。';

export function createImageJobs({ read, write, provider, plan, data }) {
  const active = new Set();
  const key = (userId, id) => `u:${userId}:image-job:${id}`;
  const sessionKey = job => `u:${job.userId}:session:${job.sessionId}`;
  const get = (userId, id) => read(key(userId, id), null);
  function update(job, changes) {
    Object.assign(job, changes); write(key(job.userId, job.id), job);
    const session = read(sessionKey(job), null), message = session?.messages?.[job.messageIndex];
    if (message?.imageJob?.id !== job.id) return;
    message.imageJob = { id: job.id, status: job.status };
    if (job.ref) message.generatedImageRef = job.ref;
    if (job.error) message.imageError = job.error;
    write(sessionKey(job), session);
  }
  function start(userId, id) {
    const job = get(userId, id);
    if (!job || job.status !== 'pending' || active.has(id)) return;
    // A paid request with an unknown outcome must not be resubmitted after a
    // restart. Only unsubmitted planning work can safely resume automatically.
    if (job.generationStartedAt || !job.id || !job.userId || (!job.prompt && !job.modelId)) {
      update({ ...job, id, userId }, { status: 'failed', error: failure }); return;
    }
    active.add(id);
    void (async () => {
      try {
        const session = read(sessionKey(job), null), message = session?.messages?.[job.messageIndex];
        if (!message || message.imageJob?.id !== id) throw new Error('Missing image message');
        if (!job.prompt) {
          const planned = await plan({ ...session, messages: session.messages.slice(0, job.messageIndex + 1) }, job);
          if (!planned.prompt) { update(job, { status: 'skipped', reason: planned.reason, completedAt: new Date().toISOString() }); return; }
          update(job, { prompt: planned.prompt });
        }
        update(job, { generationStartedAt: new Date().toISOString() });
        const generated = await provider.generate(job.prompt, userId);
        const filename = createHash('sha256').update(generated.buffer).digest('hex');
        mkdirSync(resolve(data, 'illustrations', userId), { recursive: true });
        writeFileSync(resolve(data, 'illustrations', userId, filename), generated.buffer, { mode: 0o600 });
        update(job, { status: 'completed', completedAt: new Date().toISOString(), ref: { filename, mimeType: generated.mimeType } });
      } catch { update(job, { status: 'failed', error: failure, completedAt: new Date().toISOString() }); }
      finally { active.delete(id); }
    })();
  }
  return {
    get, start,
    enqueue(userId, sessionId, messageIndex, modelId, prompt = '') {
      const session = read(`u:${userId}:session:${sessionId}`, null), message = session?.messages?.[messageIndex];
      if (!message || message.role !== 'assistant' || message.kind || message.videoCommand || message.status === 'error') throw Object.assign(new Error('请先完成一段知识讲解'), { status: 400 });
      if (message.imageJob) { start(userId, message.imageJob.id); return message.imageJob; }
      if (message.generatedImageRef) return { status: 'completed' };
      if (!provider.configured) throw Object.assign(new Error('图片生成暂未配置'), { status: 503 });
      const job = { id: randomUUID(), userId, sessionId, messageIndex, modelId, prompt, status: 'pending', createdAt: new Date().toISOString() };
      message.imageJob = { id: job.id, status: job.status };
      write(sessionKey(job), session); write(key(userId, job.id), job); start(userId, job.id);
      return message.imageJob;
    },
    recover(rows) { for (const row of rows) { const job = JSON.parse(row.body); if (job.status === 'pending' && job.id && job.userId) start(job.userId, job.id); } },
  };
}
