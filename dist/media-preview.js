export function createMediaPreview({ api, stopSpeech, isSignedIn }) {
  const $ = id => document.getElementById(id);
  let items = [], selected = null, filter = 'all', loading = false, refreshTimer;
  const stage = $('media-stage'), list = $('media-list'), status = $('media-library-status');
  const thumbnails = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const video = entry.target;
      video.preload = 'metadata'; video.src = video.dataset.src;
      thumbnails.unobserve(video);
    }
  }, { root: list, rootMargin: '80px' });
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function icon(type) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', type === 'video' ? 'M8 5l11 7-11 7Z' : 'M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M15 8h.01');
    svg.append(path); return svg;
  }
  function pane(name) {
    $('tutor').dataset.pane = name;
    document.querySelectorAll('[data-workspace-pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspacePane === name)));
    if (name === 'chat' && matchMedia('(max-width:1100px)').matches) stage.querySelector('video')?.pause();
  }
  document.querySelectorAll('[data-workspace-pane]').forEach(button => button.onclick = () => pane(button.dataset.workspacePane));
  function select(item) {
    if (selected?.url !== item?.url) {
      stage.querySelector('video')?.pause();
      stage.replaceChildren();
      stage.dataset.mediaType = item?.type || 'empty';
      if (item) {
        const media = make(item.type === 'video' ? 'video' : 'img', 'preview-media');
        if (item.type === 'video') {
          media.controls = true; media.playsInline = true; media.preload = 'metadata';
          media.setAttribute('aria-label', item.title); media.addEventListener('play', stopSpeech);
        } else media.alt = item.title;
        media.addEventListener('error', () => {
          if (!stage.querySelector('.media-load-error')) stage.append(make('p', 'media-load-error', '这份内容暂时无法加载，请刷新后再试。'));
        });
        media.src = item.url; stage.append(media);
      } else {
        const art = make('div', 'media-empty-art'); art.setAttribute('aria-hidden', 'true');
        for (const type of ['image', 'video']) { const card = make('span', ''); card.append(icon(type)); art.append(card); }
        stage.append(art, make('h3', '', '把知识，变成看得见的画面'), make('p', '', '和小直聊聊，生成的图片和视频会自动保存在这里。'));
      }
    }
    selected = item;
    $('media-selected-title').textContent = item?.title || '预览区';
    $('media-download').hidden = !item;
    if (item) {
      const url = new URL(item.url, location.origin);
      if (item.type === 'video') url.searchParams.set('download', '1');
      $('media-download').href = url.href;
      $('media-download').download = `小直${item.type === 'video' ? '视频.mp4' : '图片'}`;
    }
    list.querySelectorAll('[data-media-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mediaId === item?.id)));
  }
  function renderList() {
    const visible = items.filter(item => filter === 'all' || item.type === filter);
    thumbnails.disconnect();
    list.replaceChildren();
    status.textContent = items.length ? `${items.length} 份作品` : '还没有作品';
    for (const item of visible) {
      const button = make('button', 'media-card'); button.type = 'button'; button.dataset.mediaId = item.id;
      button.setAttribute('aria-label', `${item.type === 'video' ? '视频' : '图片'}：${item.title}`);
      const visual = make('span', 'media-card-visual');
      if (item.type === 'image') {
        const image = make('img', 'media-thumbnail'); image.src = item.url; image.alt = ''; image.loading = 'lazy'; visual.append(image);
      } else {
        const video = make('video', 'media-thumbnail'); video.muted = true; video.playsInline = true;
        video.preload = 'none'; video.dataset.src = item.url; video.tabIndex = -1; video.setAttribute('aria-hidden', 'true');
        video.addEventListener('loadedmetadata', () => { if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(.2, video.duration / 2); }, { once: true });
        const play = make('span', 'media-video-play'); play.append(icon('video')); visual.append(video, play);
        thumbnails.observe(video);
      }
      const badge = make('span', 'media-type-badge'); badge.append(icon(item.type), document.createTextNode(item.type === 'video' ? '视频' : '图片')); visual.append(badge);
      const info = make('span', 'media-card-info');
      info.append(make('strong', '', item.title));
      const date = new Date(item.createdAt);
      info.append(make('small', '', Number.isNaN(date.getTime()) ? '学习作品' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })));
      button.append(visual, info); button.onclick = () => select(item); list.append(button);
    }
    if (!visible.length && items.length) list.append(make('p', 'media-filter-empty', filter === 'video' ? '还没有生成的视频' : '还没有生成的图片'));
    select(visible.find(item => item.id === selected?.id) || visible[0] || null);
  }
  async function refresh() {
    if (loading || !isSignedIn()) return;
    loading = true; $('media-refresh').disabled = true;
    try {
      const result = await api('/api/media', undefined, { signal: AbortSignal.timeout(15000) });
      if (JSON.stringify(items) !== JSON.stringify(result.items)) {
        items = result.items; renderList();
      } else status.textContent = items.length ? `${items.length} 份作品` : '还没有作品';
    } catch { status.textContent = '历史作品加载失败，点击刷新重试。'; }
    finally { loading = false; $('media-refresh').disabled = false; }
  }
  function changed() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 300); }
  async function open(url) {
    filter = 'all'; updateFilters(); renderList();
    await refresh();
    const item = items.find(item => new URL(item.url, location.origin).pathname === new URL(url, location.origin).pathname);
    if (item) select(item);
    pane('preview');
  }
  function updateFilters() {
    document.querySelectorAll('[data-media-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mediaFilter === filter)));
  }
  document.querySelectorAll('[data-media-filter]').forEach(button => button.onclick = () => { filter = button.dataset.mediaFilter; updateFilters(); renderList(); });
  $('media-refresh').onclick = refresh;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); else stage.querySelector('video')?.pause(); });
  setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
  // Start with the empty state without waiting for login or a network response.
  selected = { url: '' }; select(null); pane('chat');
  return { refresh, changed, open, pause: () => stage.querySelector('video')?.pause() };
}
