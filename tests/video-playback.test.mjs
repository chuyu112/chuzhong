import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendSessionVideo } from '../server/video-delivery.mjs';

test('playback uses a light copy with ranges while downloads retain the original', async () => {
  const data = await mkdtemp(join(tmpdir(), 'xiaozhi-playback-'));
  const filename = 'a'.repeat(64), user = 'student';
  const session = { messages: [{ generatedVideoRef: { filename, mimeType: 'video/mp4' } }] };
  const send = (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => sendSessionVideo(req, res, send, data, user, session, 0));
  try {
    await mkdir(join(data, 'videos', user), { recursive: true });
    await mkdir(join(data, 'video-playback', user), { recursive: true });
    await writeFile(join(data, 'videos', user, filename), 'original-quality');
    await writeFile(join(data, 'video-playback', user, filename + '.mp4'), 'light-copy');
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/video`;
    assert.equal(await (await fetch(url)).text(), 'light-copy');
    const range = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), 'ght-');
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), '10');
    const download = await fetch(url + '?download=1');
    assert.match(download.headers.get('content-disposition'), /^attachment/);
    assert.equal(await download.text(), 'original-quality');
    await rm(join(data, 'video-playback', user, filename + '.mp4'));
    assert.equal(await (await fetch(url)).text(), 'original-quality');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(data, { recursive: true, force: true }); }
});
