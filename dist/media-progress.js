export function createMediaProgress(type) {
  const card = document.createElement('div');
  card.className = `media-progress ${type}-generation-status`;
  card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
  const spinner = document.createElement('span'); spinner.className = 'media-progress-spinner'; spinner.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span'); copy.className = 'media-progress-copy';
  const title = document.createElement('strong'); title.textContent = type === 'video' ? '视频正在制作中…' : '图片正在制作中…';
  const hint = document.createElement('span'); hint.textContent = '完成后会显示在这里，你可以继续聊';
  copy.append(title, hint); card.append(spinner, copy); return card;
}
