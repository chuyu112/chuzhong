import renderMathInElement from './vendor/katex/contrib/auto-render.mjs';

export function setupFamily({ api, action, node, toast }) {
  const $ = id => document.getElementById(id);
  let selectedSession = '', selectedStudent = '', loading = false, revision = '';
  const when = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录';
  const studentPath = () => '/api/family/students/' + selectedStudent;
  async function refreshLinks() {
    const links = await api('/api/family');
    const students = [...links.children, { ...links.self, name: '当前账号' }];
    if (!students.some(s => s.id === selectedStudent)) { selectedStudent = students[0].id; selectedSession = ''; }
    $('family-student').replaceChildren(...students.map(s => new Option(`${s.name} · ${s.phone}`, s.id)));
    $('family-student').value = selectedStudent;
    $('family-links').replaceChildren();
    for (const [direction, users, label] of [['child', links.children, '已关联孩子'], ['parent', links.parents, '可查看我记录的家长']]) {
      for (const user of users) {
        const row = node('div', 'family-link-row');
        row.append(node('span', '', `${label}：${user.name} · ${user.phone}`));
        const unlink = node('button', 'text-button', '解除关联');
        unlink.onclick = action(async () => {
          if (!confirm('解除后，家长将无法继续查看这个账号的学习记录。确认解除？')) return;
          await api('/api/family/unlink', { direction, id: user.id });
          await refresh(); toast('已解除关联。');
        });
        row.append(unlink); $('family-links').append(row);
      }
    }
    $('chat-note').textContent = links.parents.length ? '已关联家长可查看这些对话和作业照片。先讲思路，再一起做。' : '作业、错题拍照发来，一起把思路弄明白。';
  }
  async function showConversation(force = false) {
    if (!selectedSession) {
      $('family-conversation-title').textContent = '还没有学习对话';
      $('family-messages').replaceChildren(node('p', 'empty', '孩子发来第一个问题后，完整过程会记录在这里。'));
      return;
    }
    const saved = await api(studentPath() + '/sessions/' + selectedSession);
    const nextRevision = `${selectedStudent}:${selectedSession}:${JSON.stringify(saved)}`;
    if (!force && revision === nextRevision) return;
    revision = nextRevision;
    $('family-conversation-title').textContent = (saved.messages.find(m => m.role === 'user')?.content || '学习对话').slice(0, 70);
    const list = $('family-messages'); list.replaceChildren();
    for (const message of saved.messages) {
      const row = node('div', `parent-message ${message.role}`);
      row.append(node('small', '', `${message.role === 'user' ? '学生' : (message.agentName || '小直')} · ${when(message.at)}${message.status === 'error' ? ' · 讲解未完成' : ''}`));
      const imageUrls = message.imageUrls || (message.imageUrl ? [message.imageUrl] : []);
      if (imageUrls.length) {
        const gallery = node('div', 'chat-attachments');
        imageUrls.forEach((imageUrl, index) => {
          const link = node('a'); link.href = imageUrl; link.target = '_blank'; link.rel = 'noopener'; link.title = '打开图片';
          const image = node('img', 'chat-attachment'); image.src = imageUrl; image.alt = message.role === 'user' ? `学生上传的作业图片第 ${index + 1} 张` : '小直生成的学习图解'; link.append(image); gallery.append(link);
        });
        row.append(gallery);
      }
      const text = node('div', 'parent-message-text', message.content);
      renderMathInElement(text, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }], throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20 });
      row.append(text);
      if(message.videoUrl){const video=node('video','family-learning-video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=message.videoUrl;video.setAttribute('aria-label','知识点视频讲解');row.append(video);}
      else if(message.videoJob?.status==='pending')row.append(node('small','muted','视频制作中'));
      else if(message.videoError)row.append(node('small','muted',message.videoError));
      list.append(row);
    }
    if (saved.status === 'pending') list.append(node('p', 'muted', '这一轮讲解尚未完成，记录会自动刷新。'));
  }
  async function refreshRecords() {
    const result = await api(studentPath());
    $('family-stats').replaceChildren();
    for (const [count, label] of [[result.sessions.length, '已保存对话'], [result.sessions.reduce((n, s) => n + s.imageCount, 0), '作业图片与学习图解'], [result.memory.topics.reduce((n, t) => n + t.totalAttempts, 0), '已记录作答']]) {
      const card = node('div', 'stat'); card.append(node('strong', '', String(count)), node('span', '', label)); $('family-stats').append(card);
    }
    if (!result.sessions.some(s => s.id === selectedSession)) selectedSession = result.sessions[0]?.id || '';
    $('family-sessions').replaceChildren();
    for (const session of result.sessions) {
      const button = node('button', 'parent-session' + (session.id === selectedSession ? ' selected' : ''));
      button.append(node('strong', '', session.title), node('small', '', `${when(session.updatedAt)} · ${session.messageCount} 条消息`));
      button.onclick = action(async () => { selectedSession = session.id; await refreshRecords(); });
      $('family-sessions').append(button);
    }
    $('family-evidence').replaceChildren();
    const evidence = result.memory.topics.filter(t => t.totalAttempts || t.assistedAttempts || t.observationCount);
    if (!evidence.length) $('family-evidence').append(node('p', 'empty', '还没有足够的作答证据。可以先从对话中了解孩子的问题。'));
    for (const topic of evidence) {
      const card = node('div', 'family-topic');
      card.append(node('strong', '', `${topic.subject} · ${topic.skill || topic.topic}：${topic.status}`), node('p', '', topic.explanation));
      for(const observation of topic.recentObservations||[])card.append(node('p','',`${when(observation.at)} · ${observation.source==='image_reading'?'图片读题，待确认':'分析线索，待验证'}：${observation.evidence}\n可能卡点：${observation.hypothesis}${observation.prerequisiteName?'\n待核查基础：'+observation.prerequisiteName:''}`));
      if (topic.progress) card.append(node('p', '', topic.progress.note));
      if (topic.practiceTrend) card.append(node('p', '', `前 3 道独立作答答对 ${topic.practiceTrend.earlier.correct} 道，最近 3 道答对 ${topic.practiceTrend.latest.correct} 道。题目难度未校正。`));
      for (const attempt of topic.recentAttempts) card.append(node('small', '', `${when(attempt.at)} · ${attempt.correct ? '答对' : '待调整'} · ${{ none: '独立作答', hint: '提示后作答', solution: '已看过解答', unknown: '提示情况未记录' }[attempt.support] || '提示情况未记录'}`));
      $('family-evidence').append(card);
    }
    await showConversation();
    $('family-updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN') + ' · 每 15 秒刷新';
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try { await refreshLinks(); await refreshRecords(); } finally { loading = false; }
  }
  $('family-refresh').onclick = action(refresh);
  $('family-student').onchange = action(async () => { selectedStudent = $('family-student').value; selectedSession = ''; revision = ''; await refreshRecords(); });
  $('family-invite').onclick = action(async () => {
    const result = await api('/api/family/invite', {});
    $('family-invite-code').value = result.code; $('family-invitation').hidden = false;
    $('family-invite-expiry').textContent = '有效至 ' + when(result.expiresAt) + '。请交给你的家长。';
  });
  $('family-link-form').onsubmit = action(async event => {
    event.preventDefault(); const result = await api('/api/family/link', { code: $('family-code-input').value });
    selectedStudent = result.student.id; selectedSession = ''; $('family-code-input').value = '';
    await refresh(); toast('已关联，可以查看孩子的学习过程。');
  });
  setInterval(() => { if ($('family').classList.contains('active') && !document.hidden) refresh().catch(e => toast(e.message)); }, 15000);
  return { refresh, refreshLinks };
}
