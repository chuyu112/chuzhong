import { readFileSync } from 'node:fs';
import { buildVideoPrompt, validateVideoBrief, VIDEO_SKILL_INFO } from '../../../server/video-prompt.mjs';

try {
  const args = process.argv.slice(2), file = args.find(arg => !arg.startsWith('--'));
  if (!file || args.some(arg => arg.startsWith('--') && arg !== '--prompt')) throw new Error('用法：node skills/xiaozhi-video/scripts/check-brief.mjs 分镜.json [--prompt]');
  const source = readFileSync(file, 'utf8');
  if (source.length > 20000) throw new Error('分镜文件过大');
  const brief = validateVideoBrief(JSON.parse(source)), prompt = buildVideoPrompt(brief);
  console.log(args.includes('--prompt') ? prompt : JSON.stringify({ valid: true, skill: VIDEO_SKILL_INFO, duration: 30, resolution: '480p', ratio: '16:9', promptCharacters: prompt.length, narrationCharacters: brief.scenes.map(scene => scene.narration.length), submittedVideo: false }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
