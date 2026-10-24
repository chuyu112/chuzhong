import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';

const defaultDirectory = fileURLToPath(new URL('../skills/xiaozhi-video/', import.meta.url));

// Discover exactly this trusted project skill with Pi. The tutoring harness has
// no filesystem tools, so load its two required references on the server and
// inject their contents only in the video-planning branch of tutorPolicy.
export function loadXiaozhiVideoSkill(directory = defaultDirectory) {
  const { skills, diagnostics } = loadSkillsFromDir({ dir: directory, source: 'project' });
  const skill = skills.find(item => item.name === 'xiaozhi-video');
  if (!skill || skills.length !== 1 || diagnostics.length || skill.disableModelInvocation) throw new Error('小直视频 Skill 无效或缺失');
  const source = readFileSync(skill.filePath, 'utf8');
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  const direction = readFileSync(join(skill.baseDir, 'references/cinematic-direction.md'), 'utf8').trim();
  const contract = readFileSync(join(skill.baseDir, 'references/storyboard-contract.md'), 'utf8').trim();
  if (!body || !direction || !contract) throw new Error('小直视频 Skill 内容不完整');
  const sha256 = createHash('sha256').update(JSON.stringify([source, direction, contract])).digest('hex');
  return Object.freeze({ name: skill.name, description: skill.description, filePath: skill.filePath, direction, sha256,
    instructions: `已加载技能：${skill.name}\n${body}\n\n电影制作要求（已读取）：\n${direction}\n\n分镜输出协议（已读取）：\n${contract}` });
}
