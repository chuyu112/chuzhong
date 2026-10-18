import { DEFAULT_AGENT_NAME } from '../dist/onboarding.js';

export const defaultAppearance = { agentName: DEFAULT_AGENT_NAME, theme: 'warm', background: 'plain', avatar: '', backgroundImage: '', voiceName: '', voiceRate: 0.9, celebration: true, celebrationSound: true };
export function validateAppearance(input) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('设置格式不正确');
  if (!['warm', 'ocean', 'lilac', 'night'].includes(input.theme)) fail('请选择一种界面风格');
  if (!['plain', 'dots', 'grid', 'custom'].includes(input.background)) fail('请选择一种聊天背景');
  const picture = (value, limit) => {
    if (!value) return '';
    if (typeof value !== 'string') fail('图片格式不正确');
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match || Buffer.from(match[1], 'base64').length > limit) fail('图片过大或格式不支持，请重新选择');
    return value;
  };
  const avatar = picture(input.avatar, 200000), backgroundImage = picture(input.backgroundImage, 800000);
  if (input.background === 'custom' && !backgroundImage) fail('请先上传一张背景图片');
  const voiceRate = Number(input.voiceRate);
  if (!Number.isFinite(voiceRate) || voiceRate < 0.7 || voiceRate > 1.3) fail('朗读速度应在 0.7—1.3 倍之间');
  if (typeof input.voiceName !== 'string' || input.voiceName.length > 200) fail('朗读声音设置无效');
  const agentName = typeof input.agentName === 'string' ? input.agentName.trim() : '';
  if (!agentName || [...agentName].length > 16 || !/^[\p{L}\p{N}][\p{L}\p{N} ·_-]*$/u.test(agentName)) fail('伙伴昵称请使用 1—16 个字，可包含中文、字母和数字');
  for (const key of ['celebration', 'celebrationSound']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('庆祝设置无效');
  return { agentName, theme: input.theme, background: input.background, avatar, backgroundImage, voiceName: input.voiceName, voiceRate, celebration: input.celebration ?? true, celebrationSound: input.celebrationSound ?? true };
}
