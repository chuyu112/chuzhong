import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStudentMemory, defaultProfile } from './memory.mjs';

export function messageImage(session, index) {
  return messageImages(session, index)[0] || null;
}
export function messageImages(session, index) {
  const message = session.messages?.[index];
  if (!message) return [];
  if (Array.isArray(message.imageRefs)) return message.imageRefs;
  if (message.imageRef) return [message.imageRef];
  if (message.generatedImageRef) return [{ ...message.generatedImageRef, generated: true }];
  const firstUser = session.messages?.findIndex(item => item.role === 'user');
  if (index === firstUser && Array.isArray(session.imageRefs)) return session.imageRefs;
  if (index === firstUser && session.imageRef) return [session.imageRef];
  return [];
}
export function publicSession(saved, imageBase) {
  const { imageRef, imageRefs, ...session } = saved;
  return { ...session, hasImage: Boolean(imageRef || imageRefs?.length || session.messages?.some((_, index) => messageImages(session, index).length)), messages: (session.messages || []).map(({ imageRef, imageRefs, generatedImageRef, ...m }, index) => {
    const refs = messageImages(saved, index);
    const imageUrls = refs.map((_, item) => `${imageBase}/${index}?item=${item}`);
    return { ...m, ...(imageUrls.length ? { imageUrl: imageUrls[0], imageUrls } : {}) };
  }) };
}
export function sessionList(db, userId) {
  return db.prepare('SELECT body FROM documents WHERE id LIKE ?').all(`u:${userId}:session:%`).map(row => JSON.parse(row.body)).filter(s => s.messages?.length).map(s => ({ id: s.id, title: (s.messages.find(m => m.role === 'user')?.content || '题目讲解').replace(/\s+/g, ' ').slice(0, 40), updatedAt: s.messages.at(-1)?.at || '', messageCount: s.messages.length, imageCount: s.messages.reduce((count, _, index) => count + messageImages(s, index).length, 0) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function sendSessionImage(send, res, data, userId, session, index, item = 0) {
  const ref = messageImages(session, index)[item];
  if (!ref || !/^image\/(jpeg|png|webp)$/.test(ref.mimeType) || !/^[a-f0-9]{64}$/.test(ref.filename)) return send(res, 404, { error: '图片不存在' });
  const path = resolve(data, ref.generated ? 'illustrations' : 'homework', userId, ref.filename);
  if (!existsSync(path)) return send(res, 404, { error: '图片不存在' });
  return send(res, 200, readFileSync(path), ref.mimeType);
}

export function createFamilyRoutes({ db, data, readDocument, body, send }) {
  db.exec(`CREATE TABLE IF NOT EXISTS family_links(parent_id TEXT NOT NULL, student_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(parent_id,student_id));
    CREATE TABLE IF NOT EXISTS family_invites(code_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  const failures = new Map();
  const mask = phone => phone.slice(0, 3) + '****' + phone.slice(-4);
  const account = id => {
    const row = db.prepare('SELECT id,phone FROM accounts WHERE id=?').get(id);
    return row ? { id: row.id, phone: mask(row.phone), name: readDocument(`u:${id}:profile`, defaultProfile).displayName || '同学' } : null;
  };
  const allowed = (parent, student) => parent === student || !!db.prepare('SELECT 1 FROM family_links WHERE parent_id=? AND student_id=?').get(parent, student);
  return async (req, res, url, user) => {
    if (!url.pathname.startsWith('/api/family')) return false;
    const reply = (status, value) => { send(res, status, value); return true; };
    if (url.pathname === '/api/family' && req.method === 'GET') {
      const children = db.prepare('SELECT student_id FROM family_links WHERE parent_id=? ORDER BY created_at').all(user.id).map(r => account(r.student_id)).filter(Boolean);
      const parents = db.prepare('SELECT parent_id FROM family_links WHERE student_id=? ORDER BY created_at').all(user.id).map(r => account(r.parent_id)).filter(Boolean);
      return reply(200, { children, parents, self: account(user.id) });
    }
    if (url.pathname === '/api/family/invite' && req.method === 'POST') {
      const code = randomBytes(8).toString('hex').toUpperCase(), expiresAt = Date.now() + 10 * 60 * 1000;
      db.prepare('DELETE FROM family_invites WHERE student_id=? OR expires_at<?').run(user.id, Date.now());
      db.prepare('INSERT INTO family_invites VALUES(?,?,?)').run(createHash('sha256').update(code).digest('hex'), user.id, expiresAt);
      return reply(200, { code, expiresAt });
    }
    if (url.pathname === '/api/family/link' && req.method === 'POST') {
      const recent = (failures.get(user.id) || []).filter(at => at > Date.now() - 600000);
      if (recent.length >= 10) return reply(429, { error: '关联码尝试次数过多，请 10 分钟后再试' });
      const input = await body(req, 10000), code = String(input.code || '').replace(/\s/g, '').toUpperCase();
      const hash = createHash('sha256').update(code).digest('hex');
      const invitation = db.prepare('SELECT student_id FROM family_invites WHERE code_hash=? AND expires_at>?').get(hash, Date.now());
      if (!invitation) { failures.set(user.id, [...recent, Date.now()]); return reply(400, { error: '关联码无效或已过期，请在孩子账号里重新生成' }); }
      if (invitation.student_id === user.id) return reply(400, { error: '请用家长自己的账号填写孩子的关联码' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO family_links VALUES(?,?,?)').run(user.id, invitation.student_id, new Date().toISOString());
        db.prepare('DELETE FROM family_invites WHERE code_hash=?').run(hash);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      failures.delete(user.id);
      return reply(200, { student: account(invitation.student_id) });
    }
    if (url.pathname === '/api/family/unlink' && req.method === 'POST') {
      const input = await body(req, 10000);
      if (input.direction === 'parent') db.prepare('DELETE FROM family_links WHERE parent_id=? AND student_id=?').run(String(input.id), user.id);
      else db.prepare('DELETE FROM family_links WHERE parent_id=? AND student_id=?').run(user.id, String(input.id));
      return reply(200, { ok: true });
    }
    const route = /^\/api\/family\/students\/([\w-]{1,80})(?:\/sessions\/([\w-]{1,80})(?:\/images\/(\d{1,6}))?)?$/.exec(url.pathname);
    if (route && req.method === 'GET') {
      const [, studentId, sessionId, imageIndex] = route;
      if (!allowed(user.id, studentId)) return reply(403, { error: '请先关联孩子的账号' });
      if (!account(studentId)) return reply(404, { error: '账号不存在' });
      if (sessionId) {
        const saved = readDocument(`u:${studentId}:session:${sessionId}`, null);
        if (!saved) return reply(404, { error: '对话不存在' });
        if (imageIndex !== undefined) { sendSessionImage(send, res, data, studentId, saved, Number(imageIndex), Number(url.searchParams.get('item') || 0)); return true; }
        return reply(200, publicSession(saved, `/api/family/students/${studentId}/sessions/${sessionId}/images`));
      }
      const learning = readDocument(`u:${studentId}:learning`, { questions: [], attempts: [], helpEvents: [] });
      return reply(200, { student: account(studentId), sessions: sessionList(db, studentId), memory: buildStudentMemory(learning, readDocument(`u:${studentId}:profile`, defaultProfile)) });
    }
    return reply(404, { error: '接口不存在' });
  };
}
