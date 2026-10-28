export function createMediaPreview({ api, stopSpeech, isSignedIn }) {
  const $ = id => document.getElementById(id);
  let items = [], selected = null, filter = 'all', loading = false, refreshTimer;
  const stage = $('media-stage'), list = $('media-list'), status = $('media-library-status');
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
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
        stage.append(make('span', 'media-empty-icon', '▧'), make('h3', '', '图片和视频，都在这里'), make('p', '', '生成完成后会自动收好，也可以随时回看以前的作品。'));
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
    list.replaceChildren();
    status.textContent = items.length ? `共 ${items.length} 份 · 按最新生成排序` : '还没有生成的图片或视频';
    for (const item of visible) {
      const button = make('button', 'media-card'); button.type = 'button'; button.dataset.mediaId = item.id;
      button.setAttribute('aria-label', `${item.type === 'video' ? '视频' : '图片'}：${item.title}`);
      if (item.type === 'image') {
        const image = make('img', 'media-thumbnail'); image.src = item.url; image.alt = ''; image.loading = 'lazy'; button.append(image);
      } else button.append(make('span', 'media-thumbnail video-thumbnail', '▶'));
      const info = make('span', 'media-card-info');
      info.append(make('strong', '', item.title));
      const date = new Date(item.createdAt);
      info.append(make('small', '', `${item.type === 'video' ? '视频' : '图片'}${Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleDateString('zh-CN')}`));
      button.append(info); button.onclick = () => select(item); list.append(button);
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
      } else status.textContent = items.length ? `共 ${items.length} 份 · 按最新生成排序` : '还没有生成的图片或视频';
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
