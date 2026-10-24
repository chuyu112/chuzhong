import { mkdtemp, writeFile, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateVideoBrief } from './video-prompt.mjs';

const timestamp = seconds => { const cs = Math.round(seconds * 100); return `0:${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
export function englishSubtitleCues(input) {
  const brief = validateVideoBrief(input);
  if (brief.mode !== 'english_roleplay') return [];
  return brief.scenes.flatMap((scene, index) => scene.dialogue.map(line => ({ start: index * 10 + line.start, end: index * 10 + line.end, text: line.text, focus: line.focus })));
}
export function englishSubtitleAss(input, fontName = 'Noto Sans') {
  const cues = englishSubtitleCues(input);
  if (!cues.length) throw new Error('没有英文台词可添加字幕');
  const lines = cues.map(cue => {
    // The brief validator rejects ASS control syntax/newlines in spoken text.
    // Highlight only a literal substring, never interpret model text as markup.
    let text = cue.text;
    const offset = cue.focus ? text.toLowerCase().indexOf(cue.focus.toLowerCase()) : -1;
    if (offset >= 0) text = text.slice(0, offset) + '{\\c&H0066D9FF&\\b1}' + text.slice(offset, offset + cue.focus.length) + '{\\r}' + text.slice(offset + cue.focus.length);
    return `Dialogue: 0,${timestamp(cue.start)},${timestamp(cue.end)},Default,,0,0,0,,${text}`;
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 854\nPlayResY: 480\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},25,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,42,42,24,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}

export async function addEnglishSubtitles(buffer, brief, { execImpl, ffmpegPath = 'ffmpeg', fontPath = process.env.EDU_VIDEO_FONT_PATH } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'zhixu-subtitles-'));
  try {
    const font = fontPath || ['/usr/share/fonts/google-noto-vf/NotoSans-VF.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(existsSync);
    if (!font) throw new Error('subtitle font unavailable');
    await mkdir(join(directory, 'fonts'));
    await copyFile(font, join(directory, 'fonts', 'English.ttf'));
    const fontName = font.includes('Arial') ? 'Arial' : font.includes('DejaVu') ? 'DejaVu Sans' : 'Noto Sans';
    await writeFile(join(directory, 'source.mp4'), buffer);
    await writeFile(join(directory, 'subtitles.ass'), englishSubtitleAss(brief, fontName));
    await execImpl(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'source.mp4', '-map', '0:v:0', '-map', '0:a:0', '-vf', 'ass=subtitles.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'captioned.mp4'], { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    return await readFile(join(directory, 'captioned.mp4'));
  } catch { throw Object.assign(new Error('英文字幕处理未完成，可重试获取原视频并添加字幕'), { code: 'VIDEO_SUBTITLES_FAILED' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
