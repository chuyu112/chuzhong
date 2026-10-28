import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mediaLibrary } from '../server/media-library.mjs';

test('media library includes all completed creations, isolates accounts, and omits storage secrets and homework', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE documents(id TEXT PRIMARY KEY, body TEXT)');
    const save = (user, id, messages) => db.prepare('INSERT INTO documents VALUES (?, ?)').run(`u:${user}:session:${id}`, JSON.stringify({ id, messages }));
    save('a_b', 'old', [
      { role: 'user', content: '作业题', imageRefs: [{ filename: 'private-homework' }] },
      { role: 'assistant', at: '2026-10-25', content: 'secret response', generatedImageRef: { filename: 'private-image' } },
      { role: 'assistant', at: '2026-10-26', generatedVideoRef: { storage: 'oss', key: 'private-oss-key' } },
      { role: 'assistant', videoJob: { status: 'pending', id: 'private-job' } },
      { role: 'assistant', imageJob: { status: 'failed' } },
    ]);
    save('a_b', 'new', [{ role: 'assistant', at: '2026-10-27', generatedVideoRef: { filename: 'private-video' } }]);
    save('axb', 'other', [{ role: 'assistant', at: '2026-10-28', generatedImageRef: { filename: 'other-user-secret' } }]);
    const items = mediaLibrary(db, 'a_b');
    assert.deepEqual(items.map(i => i.id), ['new:0:video', 'old:2:video', 'old:1:image']);
    assert.equal(items[1].url, '/api/sessions/old/videos/2');
    assert.equal(items[2].url, '/api/sessions/old/images/1');
    assert.doesNotMatch(JSON.stringify(items), /private|secret|filename|storage|other/);
    assert.deepEqual(mediaLibrary(db, 'nobody'), []);
  } finally { db.close(); }
});
