import { DEFAULT_AGENT_NAME } from './onboarding.js';

export function setupAppearance({ api, toast, speech, onAgentName }) {
  const $ = id => document.getElementById(id);
  let saved = { agentName: DEFAULT_AGENT_NAME, theme: 'warm', background: 'plain', avatar: '', backgroundImage: '', voiceName: '', voiceRate: 0.9, celebration: true, celebrationSound: true }, draft = { ...saved };
  const guard = fn => async event => { try { await fn(event); } catch (error) { $('custom-error').textContent = error.message; $('custom-error').hidden = false; } };
  function apply(value) {
    onAgentName?.(value.agentName || DEFAULT_AGENT_NAME);
    $('custom-voice-preview').textContent = `试听${value.agentName || DEFAULT_AGENT_NAME}的声音`;
    document.body.dataset.theme = value.theme;
    const chat = document.querySelector('.chat-workspace'); chat.dataset.background = value.background;
    chat.style.setProperty('--wallpaper-image', value.backgroundImage ? `url("${value.backgroundImage}")` : 'none');
    const avatar = $('student-avatar'); avatar.style.backgroundImage = value.avatar ? `url("${value.avatar}")` : '';
    avatar.classList.toggle('has-custom-avatar', Boolean(value.avatar));
    document.body.classList.toggle('custom-chat-avatar', Boolean(value.avatar));document.body.style.setProperty('--user-avatar', value.avatar ? `url("${value.avatar}")` : 'none');
    $('custom-avatar-preview').style.backgroundImage = value.avatar ? `url("${value.avatar}")` : '';
    $('custom-avatar-preview').textContent = value.avatar ? '' : '我';
    $('custom-background-preview').hidden = !value.backgroundImage;
    if (value.backgroundImage) $('custom-background-preview').src = value.backgroundImage; else $('custom-background-preview').removeAttribute('src');
  }
  function voices() {
    const list = window.speechSynthesis?.getVoices() || [];
    const chinese = list.filter(v => /^zh|^cmn|^yue/i.test(v.lang));
    $('custom-voice').replaceChildren(new Option('自动选择中文声音', ''), ...chinese.map(v => new Option(`${v.name} · ${v.lang}`, v.name)));
    if (draft.voiceName && !chinese.some(v => v.name === draft.voiceName)) $('custom-voice').append(new Option(`${draft.voiceName}（此设备暂不可用）`, draft.voiceName));
    $('custom-voice').value = draft.voiceName;
    $('custom-voice-preview').disabled = !('speechSynthesis' in window);
    $('custom-voice-note').textContent = !('speechSynthesis' in window) ? '当前浏览器不支持朗读，请换用支持语音的浏览器。' : chinese.length ? '声音由当前设备提供，换设备后可能自动使用其他中文声音。' : '设备尚未提供中文声音列表，朗读时会尝试系统默认声音。';
  }
  function voiceOptions() { return { name: saved.voiceName, rate: saved.voiceRate }; }
  async function refresh() { saved = { ...saved, ...await api('/api/appearance') }; draft = { ...saved }; apply(saved); }
  $('customize-open').onclick = () => {
    speech.stop(); $('account-dialog').close(); draft = { ...saved }; $('custom-error').hidden = true;
    $('customize-form').querySelector(`input[name="theme"][value="${draft.theme}"]`).checked = true;
    $('custom-background').value = draft.background; $('custom-rate').value = draft.voiceRate; $('custom-rate-label').textContent = Number(draft.voiceRate).toFixed(1) + ' 倍';
    $('custom-agent-name').value = draft.agentName;
    $('custom-celebration').checked = draft.celebration;
    $('custom-celebration-sound').checked = draft.celebrationSound;
    voices(); apply(draft); $('customize-dialog').showModal();
  };
  $('customize-close').onclick = () => { apply(saved); $('customize-dialog').close(); };
  $('customize-dialog').addEventListener('cancel', () => apply(saved));
  $('customize-dialog').addEventListener('close', () => { speech.stop(); apply(saved); });
  $('customize-form').querySelectorAll('[name="theme"]').forEach(input => input.onchange = () => { draft.theme = input.value; apply(draft); });
  $('custom-background').onchange = () => { draft.background = $('custom-background').value; apply(draft); if (draft.background === 'custom' && !draft.backgroundImage) $('custom-background-file').click(); };
  $('custom-agent-name').oninput = () => { draft.agentName = $('custom-agent-name').value.trim(); apply(draft); };
  $('custom-voice').onchange = () => { draft.voiceName = $('custom-voice').value; };
  $('custom-celebration').onchange = () => { draft.celebration = $('custom-celebration').checked; };
  $('custom-celebration-sound').onchange = () => { draft.celebrationSound = $('custom-celebration-sound').checked; };
  $('custom-rate').oninput = () => { draft.voiceRate = Number($('custom-rate').value); $('custom-rate-label').textContent = draft.voiceRate.toFixed(1) + ' 倍'; };
  $('custom-voice-preview').onclick = () => speech.toggle({
    text:`你好呀，我是${draft.agentName || DEFAULT_AGENT_NAME}。我们一起把问题想明白，一步一步来。`,
    voice:{name:draft.voiceName,rate:draft.voiceRate},button:$('custom-voice-preview'),
    onState:state=>{ $('custom-voice-preview').textContent=state==='idle'?`试听${draft.agentName || DEFAULT_AGENT_NAME}的声音`:state==='loading'?'■ 取消 · 准备中':state==='paused'?'▶ 继续试听':'⏸ 暂停试听'; }
  });
  window.speechSynthesis?.addEventListener('voiceschanged', () => { if ($('customize-dialog').open) voices(); });
  async function picture(file, avatar) {
    if (!file) return;
    const currentDraft = draft;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25 * 1024 * 1024) throw new Error('请选择 25 MB 以内的 JPG、PNG 或 WebP 图片。');
    const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (avatar) {
      canvas.width = canvas.height = 256; const size = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
    } else {
      const ratio = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height)); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    bitmap.close(); let quality = 0.8, value = canvas.toDataURL('image/jpeg', quality);
    while (value.length > (avatar ? 250000 : 1000000) && quality > 0.3) { quality -= 0.1; value = canvas.toDataURL('image/jpeg', quality); }
    if (value.length > (avatar ? 250000 : 1000000)) throw new Error('图片细节太多，请选择更小的图片。');
    if (!$('customize-dialog').open || currentDraft !== draft) return;
    if (avatar) draft.avatar = value; else { draft.backgroundImage = value; draft.background = 'custom'; $('custom-background').value = 'custom'; }
    apply(draft);
  }
  for (const kind of ['avatar', 'background']) {
    $(`custom-${kind}-upload`).onclick = () => $(`custom-${kind}-file`).click();
    $(`custom-${kind}-file`).onchange = guard(async event => { const file = event.target.files[0]; event.target.value = ''; await picture(file, kind === 'avatar'); });
    $(`custom-${kind}-clear`).onclick = () => { if (kind === 'avatar') draft.avatar = ''; else { draft.backgroundImage = ''; draft.background = 'plain'; $('custom-background').value = 'plain'; } apply(draft); };
  }
  $('customize-form').onsubmit = guard(async event => {
    event.preventDefault(); $('custom-save').disabled = true; $('custom-error').hidden = true;
    try { saved = await api('/api/appearance', draft); $('customize-dialog').close(); apply(saved); toast('你的个性化设置已保存。'); } finally { $('custom-save').disabled = false; }
  });
  return { refresh, voiceOptions, celebrationOptions: () => ({ visual: saved.celebration, sound: saved.celebrationSound }), agentName: () => saved.agentName || DEFAULT_AGENT_NAME };
}
