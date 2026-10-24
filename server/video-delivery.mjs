import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function sendSessionVideo(req, res, send, data, userId, session, index) {
  const ref = session?.messages?.[index]?.generatedVideoRef;
  if (!ref || ref.mimeType !== 'video/mp4' || !/^[a-f0-9]{64}$/.test(ref.filename)) return send(res, 404, { error: '视频不存在' });
  const file = resolve(data, 'videos', userId, ref.filename);
  let size; try { size = statSync(file).size; } catch { return send(res, 404, { error: '视频不存在' }); }
  const headers = { 'content-type': 'video/mp4', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' };
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    const reject = () => { res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }); res.end(); };
    if (!match || (!match[1] && !match[2])) return reject();
    if (!match[1]) { start = Math.max(0, size - Number(match[2])); } else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return reject();
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
