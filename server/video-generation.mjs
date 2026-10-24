import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const exec = (file, args, options) => new Promise((resolve, reject) => {
  const child = execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  // CLI treats piped stdin as node-edit input; always close the empty stream.
  child.stdin?.end();
});
const MODEL = 'Seedance 2.5（样片模式）';
const idPattern = /^[\w-]{1,80}$/;

export function videoNodeState(value) {
  const node = Array.isArray(value) ? value[0] : value;
  if (!node?.nodeKey || node.data?.type !== 'video') throw new Error('无效视频节点');
  const task = node.data.taskInfo;
  const urls = node.data.url;
  if (Number(task?.status) === 3) return { status: 'failed' };
  // A task being rerun must never expose an older asset as the new result.
  if (task?.loading) return { status: 'pending' };
  if (Array.isArray(urls) && urls.length) return { status: 'completed' };
  return { status: 'pending' };
}

export function validateVideoMetadata(metadata) {
  const video = metadata.streams?.find(s => s.codec_type === 'video');
  const duration = Number(metadata.format?.duration || video?.duration);
  if (!video || Math.abs(duration - 30) > 0.7 || video.height !== 480 || Math.abs(video.width / video.height - 16 / 9) > 0.015 || !metadata.streams?.some(s => s.codec_type === 'audio')) {
    throw new Error('生成的视频未达到30秒、480p横屏或旁白要求');
  }
  return { duration, width: video.width, height: video.height };
}

export function createVideoGenerationService({ enabled = false, cliPath = 'libtv', ffprobePath = 'ffprobe', execImpl = exec, fetchImpl = fetch, credentialsPath = join(process.env.LIBTV_CONFIG_DIR || join(homedir(), '.libtv'), 'credentials.json') } = {}) {
  const call = async (args, timeout = 30000) => {
    const result = await execImpl(cliPath, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
    return result.stdout;
  };
  const ids = (projectId, nodeId) => { if (!idPattern.test(projectId) || !idPattern.test(nodeId)) throw new Error('视频任务标识无效'); };
  return {
    configured: enabled, model: MODEL,
    async createProject(jobId) {
      if (!enabled || !idPattern.test(jobId)) throw new Error('视频生成暂未配置');
      const result = JSON.parse(await call(['project', 'create', `知序学习-${jobId.slice(0, 8)}`, '-d', '30秒知识点讲解', '--team-id', '0']));
      if (!idPattern.test(result.projectMeta?.uuid || '')) throw new Error('视频项目创建失败');
      return result.projectMeta.uuid;
    },
    async createNode(projectId, jobId, prompt) {
      ids(projectId, jobId);
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 14000) throw new Error('视频说明无效');
      const value = JSON.parse(await call(['node', 'create', `learning-${jobId}`, '-p', projectId, '-t', 'video', '--prompt', prompt,
        '-s', `model=${MODEL}`, '-s', 'modeType=text2video', '-s', 'ratio=16:9', '-s', 'resolution=480p', '-s', 'duration=30', '-s', 'enableSound=on', '-s', 'count=1']));
      if (!idPattern.test(value.nodeKey || '')) throw new Error('视频节点创建失败');
      return value.nodeKey;
    },
    // The caller must persist submission BEFORE calling this. An interrupted
    // command is an unknown outcome; inspect the same node, never run it again.
    async submit(projectId, nodeId) {
      ids(projectId, nodeId);
      await call(['node', nodeId, '-p', projectId, '--run'], 10 * 60 * 1000);
    },
    async inspect(projectId, nodeId) {
      ids(projectId, nodeId);
      const node = JSON.parse(await call(['node', nodeId, '-p', projectId]));
      const state = videoNodeState(node), taskId = node.data?.taskInfo?.taskId;
      if (state.status !== 'pending') return state;
      if (!taskId) return { ...state, awaitingSubmission: true };
      // Official CLI 1.0.2 polls this endpoint and writes the result back to the
      // canvas. Read it directly too, so CLI/server restarts cannot strand a task.
      const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
      const response = await fetchImpl('https://api.liblib.tv/api/task/generation/progress', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: {
        'content-type': 'application/json', token: credentials.usertoken, webid: credentials.webid, 'x-language': 'zh', 'X-from-client': 'cli',
      }, body: JSON.stringify({ taskIds: [taskId] }) });
      if (!response.ok) throw new Error('视频状态读取失败');
      const result = await response.json(), progress = result.data?.progresses?.find(p => p.taskId === taskId);
      if (result.code !== 0 || !progress) throw new Error('视频状态读取失败');
      if (Number(progress.status) === 3) return { status: 'failed' };
      if (Number(progress.status) === 2) {
        const media = JSON.parse(progress.taskResult || '{}').videos?.[0];
        const url = media?.videoUrl || media?.previewPath || media?.url || media?.originalPath || media?.storagePath;
        if (typeof url === 'string') return { status: 'completed', url };
      }
      return { status: 'pending' };
    },
    async download(projectId, nodeId, resourceUrl) {
      ids(projectId, nodeId);
      const directory = await mkdtemp(join(tmpdir(), 'zhixu-video-'));
      try {
        if (resourceUrl) {
          const url = new URL(resourceUrl);
          if (url.protocol !== 'https:' || !['liblib.cloud', 'liblib.art', 'liblib.tv'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw new Error('视频资源地址无效');
          const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
          if (!response.ok || Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('视频下载失败');
          let size = 0; const chunks = [];
          for await (const chunk of response.body) { size += chunk.length; if (size > 100 * 1024 * 1024) throw new Error('视频文件过大'); chunks.push(chunk); }
          await writeFile(join(directory, 'learning.mp4'), Buffer.concat(chunks));
        } else await call(['download', '-n', nodeId, '-p', projectId, '-o', directory], 120000);
        const files = await readdir(directory);
        if (files.length !== 1 || !files[0].toLowerCase().endsWith('.mp4')) throw new Error('未返回完整视频');
        const file = join(directory, files[0]), info = await stat(file);
        if (!info.isFile() || info.size > 100 * 1024 * 1024 || !info.size) throw new Error('视频文件大小无效');
        const result = await execImpl(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
        const metadata = validateVideoMetadata(JSON.parse(result.stdout));
        return { buffer: await readFile(file), mimeType: 'video/mp4', ...metadata };
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}
