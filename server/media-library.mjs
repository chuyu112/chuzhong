// List completed creations only. URLs still pass through the existing, authenticated
// session delivery routes; storage keys and other users' sessions never leave here.
export function mediaLibrary(db, userId) {
  const prefix = `u:${userId}:session:`;
  const rows = db.prepare('SELECT body FROM documents WHERE substr(id, 1, ?) = ?').all(prefix.length, prefix);
  const items = [];
  for (const row of rows) {
    const session = JSON.parse(row.body);
    if (!/^[\w-]{1,80}$/.test(session.id || '')) continue;
    const title = (session.messages?.find(m => m.role === 'user')?.content || '学习讲解').replace(/\s+/g, ' ').slice(0, 100);
    (session.messages || []).forEach((message, index) => {
      if (message.role !== 'assistant') return;
      const base = { sessionId: session.id, messageIndex: index, title, createdAt: message.at || '' };
      if (message.generatedImageRef) items.push({ ...base, id: `${session.id}:${index}:image`, type: 'image', url: `/api/sessions/${session.id}/images/${index}` });
      if (message.generatedVideoRef) items.push({ ...base, id: `${session.id}:${index}:video`, type: 'video', url: `/api/sessions/${session.id}/videos/${index}` });
    });
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.messageIndex - a.messageIndex || a.id.localeCompare(b.id));
}
