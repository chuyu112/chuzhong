export function createVideoUI({ api, getState, stopSpeech }) {
  const watchers = new Map();
  function renderVideo(message, url) {
    if (message.querySelector('video')) return;
    const figure = document.createElement('figure'); figure.className = 'learning-video';
    const video = document.createElement('video');
    video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.src = url;
    video.setAttribute('aria-label', '知识点视频讲解'); video.addEventListener('play', stopSpeech);
    const caption = document.createElement('figcaption'); caption.textContent = '用画面再理解一遍';
    figure.append(video, caption); message.append(figure);
  }
  function attach(message, saved, sessionId, index) {
    if (saved.role !== 'assistant' || saved.kind || saved.status === 'error' || !Number.isInteger(index)) return;
    if (!saved.videoJob && !saved.videoUrl) return;
    const controls = message.querySelector('.speech-controls'); if (!controls) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'learning-video-button';
    button.title = '查看视频'; button.setAttribute('aria-label', '查看视频'); button.disabled = true;
    button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>';
    controls.append(button);
    let job = saved.videoJob;
    let watching = false;
    function status(text, failed = false) {
      let label = message.querySelector('.video-generation-status');
      if (!label) { label = document.createElement('small'); label.className = 'video-generation-status'; label.setAttribute('role', 'status'); controls.after(label); }
      label.textContent = text; label.classList.toggle('error', failed);
    }
    function finish(url) {
      button.disabled = false; button.title = '查看视频'; button.setAttribute('aria-label', '查看视频');
      message.querySelector('.video-generation-status')?.remove(); renderVideo(message, url);
      button.onclick = () => message.querySelector('video')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    async function watch() {
      if (watching) return;
      watching = true;
      try {
        button.disabled = true; status('视频在制作了，你可以继续问。');
        while (message.isConnected && getState().sessionId === sessionId) {
          try {
            const result = await api('/api/video-jobs/' + encodeURIComponent(job.id), undefined, { signal: AbortSignal.timeout(15000) });
            if (!message.isConnected || getState().sessionId !== sessionId) return;
            if (result.status === 'completed' && result.videoUrl) { finish(result.videoUrl); return; }
            if (result.status === 'failed') { status('这次视频没生成成功。你可以说“重试”，或“换个模型重试”。', true); return; }
          } catch { /* transient network errors do not restart paid generation */ }
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      } finally { watching = false; }
    }
    for (const [key, entry] of watchers) if (!entry.message.isConnected) watchers.delete(key);
    if (job?.id) watchers.set(sessionId + ':' + job.id, { message, resume: updated => { job = updated; void watch(); } });
    if (saved.videoUrl) finish(saved.videoUrl);
    else if (job?.status === 'pending') void watch();
    else if (job?.status === 'failed') { button.disabled = true; status('这次视频没生成成功。你可以说“重试”，或“换个模型重试”。', true); }
    else if (saved.videoError) status(saved.videoError, true);
  }
  return { attach, resume(job, sessionId) { if (job?.id) watchers.get(sessionId + ':' + job.id)?.resume(job); } };
}
