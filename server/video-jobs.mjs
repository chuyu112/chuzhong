import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Durable state is stored before any paid submission. Recovery only inspects
// an already submitted node. It never repeats --run after an unknown outcome.
export function createVideoJobs({ read, write, provider, plan, data, canGenerate = () => true, pollMs = 5000, waitMs = 10 * 60 * 1000 }) {
  const active = new Set(), retrying = new Set();
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
      else delete message.videoError;
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
      let stage = 'preparing';
      try {
        const session = read(sessionKey(job), null);
        if (!session || session.messages?.[job.messageIndex]?.videoJob?.id !== id) throw new Error('missing message');
        if (!session.messages[job.messageIndex].videoCommand && !job.submittedAt) throw new Error('Video generation requires the slash command');
        if (!job.prompt) {
          stage = 'planning'; update(job, { stage });
          const planned = await plan({ ...session, messages: session.messages.slice(0, job.messageIndex + 1) }, job);
          update(job, { prompt: planned.prompt, title: planned.brief.title, ...(planned.skill ? { skill: planned.skill } : {}) });
        }
        if (!job.projectId) { stage = 'creating_project'; update(job, { stage }); update(job, { projectId: await provider.createProject(id) }); }
        if (!job.nodeId) { stage = 'creating_node'; update(job, { stage }); update(job, { nodeId: await provider.createNode(job.projectId, id, job.prompt) }); }
        if (!job.submittedAt) {
          update(job, { submittedAt: Date.now() });
          // CLI may wait for completion. Polling is independent, so this doesn't
          // hold the chat response or prevent recovery after process restart.
          void provider.submit(job.projectId, job.nodeId).catch(() => {});
        }
        stage = 'generating'; update(job, { stage });
        const watchStartedAt = Date.now();
        while (Date.now() - watchStartedAt < waitMs) {
          let status;
          try { status = await provider.inspect(job.projectId, job.nodeId); } catch { await delay(pollMs); continue; }
          if (status.awaitingSubmission && Date.now() - job.submittedAt > 90000) throw new Error('submission not confirmed');
          if (status.status === 'completed') {
            stage = 'downloading'; update(job, { stage });
            const result = await provider.download(job.projectId, job.nodeId, status.url);
            const filename = createHash('sha256').update(result.buffer).digest('hex');
            const folder = resolve(data, 'videos', userId); mkdirSync(folder, { recursive: true });
            writeFileSync(resolve(folder, filename), result.buffer, { mode: 0o600 });
            update(job, { status: 'completed', stage: 'completed', completedAt: new Date().toISOString(), ref: { filename, mimeType: 'video/mp4', duration: result.duration, width: result.width, height: result.height } });
            break;
          }
          if (status.status === 'failed') throw new Error('provider failed');
          await delay(pollMs);
        }
        // A slow provider remains pending; reopening/polling resumes this same
        // task instead of generating or charging again.
      } catch (error) {
        const planningCodes = ['VIDEO_PLANNING_TIMEOUT', 'VIDEO_MODEL_REQUEST_FAILED', 'VIDEO_BRIEF_INVALID'];
        const failureCode = planningCodes.includes(error.code) ? error.code : 'VIDEO_STAGE_FAILED';
        update(job, { status: 'failed', failureStage: stage, failureCode, failedAt: new Date().toISOString(), ...(planningCodes.includes(error.code) ? { diagnostics: error.diagnostics || [] } : {}), error: '这次视频没生成成功。你可以说“重试”，或“换个模型重试”。' });
      } finally { active.delete(id); }
    })();
  }
  return {
    get, start,
    async retry(userId, id, modelId) {
      if (!canGenerate(userId)) throw Object.assign(new Error('视频功能暂未向此账号开放'), { status: 403 });
      const job = get(userId, id);
      if (!job) throw Object.assign(new Error('视频任务不存在'), { status: 404 });
      const session = read(sessionKey(job), null), message = session?.messages?.[job.messageIndex];
      if (!message?.videoCommand || message.videoJob?.id !== id) throw Object.assign(new Error('只能重试由 /视频生成 创建的任务'), { status: 400 });
      const receipt = () => ({ videoJob: { id, status: job.status }, videoUrl: job.status === 'completed' ? `/api/sessions/${job.sessionId}/videos/${job.messageIndex}` : null });
      if (job.status === 'completed' || job.status === 'pending') { start(userId, id); return receipt(); }
      if (!provider.configured) throw Object.assign(new Error('视频生成暂未配置'), { status: 503 });
      if (retrying.has(id)) throw Object.assign(new Error('正在核对原任务，请稍等。'), { status: 409 });
      retrying.add(id);
      try {
        if (job.submittedAt) {
          let remote;
          try { remote = await provider.inspect(job.projectId, job.nodeId); }
          catch { throw Object.assign(new Error('暂时无法确认原任务状态，请稍后重试。'), { status: 409 }); }
          if (remote.status !== 'failed') {
            if (!['pending', 'completed'].includes(remote.status)) throw Object.assign(new Error('原任务结果尚未确认，请稍后重试。'), { status: 409 });
            // Recover the existing submission, including a completed video
            // whose download failed. A retry must not pay for it twice.
            delete job.error; update(job, { status: 'pending', stage: 'recovering' }); start(userId, id);
            return receipt();
          }
        }
        job.attempts = [...(job.attempts || []), { modelId: job.modelId, projectId: job.projectId, nodeId: job.nodeId, submittedAt: job.submittedAt, failureStage: job.failureStage, failureCode: job.failureCode, failedAt: job.failedAt }].slice(-5);
        for (const field of ['prompt', 'nodeId', 'submittedAt', 'ref', 'brief', 'skill', 'title', 'error', 'failureStage', 'failureCode', 'failedAt', 'completedAt', 'diagnostics']) delete job[field];
        update(job, { status: 'pending', stage: 'planning', modelId, retriedAt: new Date().toISOString() });
        start(userId, id); return receipt();
      } finally { retrying.delete(id); }
    },
    enqueue(userId, sessionId, messageIndex, modelId) {
      if (!canGenerate(userId)) throw Object.assign(new Error('视频功能暂未向此账号开放'), { status: 403 });
      const session = read(`u:${userId}:session:${sessionId}`, null), message = session?.messages?.[messageIndex];
      if (!message || message.role !== 'assistant' || message.kind || message.status === 'error') throw Object.assign(new Error('请先完成一段知识讲解'), { status: 400 });
      if (!message.videoCommand) throw Object.assign(new Error('请在聊天中输入 /视频生成'), { status: 400 });
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
