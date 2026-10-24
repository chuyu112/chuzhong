import { mkdtemp, writeFile, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { validateVideoBrief } from './video-prompt.mjs';
import { alignEnglishCues, recognizeVideoSpeech } from './video-audio-alignment.mjs';

const timestamp = seconds => { const cs = Math.round(seconds * 100); return `0:${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
export function englishSubtitleCues(input) {
  const brief = validateVideoBrief(input, { allowLegacyEnglish: true });
  if (brief.mode !== 'english_roleplay') return [];
  let offset = 0;
  return brief.scenes.flatMap(scene => {
    const cues = scene.dialogue.map((line, index) => ({ start: offset + line.start,
      // Hold the explanation through the learning pause without stretching the audio.
      end: offset + (scene.stage === 'word_by_word' ? (scene.dialogue[index + 1]?.start ?? scene.seconds) : line.end), text: line.text, focus: line.focus,
      ...(line.translation ? { translation: line.translation } : {}),
      ...(scene.stage === 'word_by_word' ? { meaning: brief.chunks[index].meaning, usage: brief.chunks[index].usage } : {}),
      ...(scene.stage === 'breakdown' && line.focus ? (() => {
        const chunk = brief.chunks.find(item => item.phrase.toLowerCase() === line.focus.toLowerCase());
        return chunk ? { meaning: chunk.meaning, usage: chunk.usage } : {};
      })() : {}),
      stage: scene.stage || 'legacy',
      ...(!scene.stage && !line.translation && line.focus ? (() => {
        const chunk = brief.chunks.find(item => item.phrase.toLowerCase() === line.focus.toLowerCase());
        return chunk ? { meaning: chunk.meaning } : {};
      })() : {}),
    }));
    offset += scene.seconds;
    return cues;
  });
}
// Explanations are model text, not ASS markup; neutralize override and newline syntax.
const subtitleLiteral = text => text.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/[\r\n\u2028\u2029]/g, ' ');
export function englishSubtitleAss(input, fontName = 'Noto Sans', chineseFontName = 'Noto Sans CJK SC', audioCues) {
  if (/[{},\\\r\n]/.test(chineseFontName)) throw new Error('Invalid Chinese subtitle font name');
  const cues = audioCues || englishSubtitleCues(input);
  if (!cues.length) throw new Error('没有英文台词可添加字幕');
  const lines = cues.map(cue => {
    // The brief validator rejects ASS control syntax/newlines in spoken text.
    // Highlight only a literal substring, never interpret model text as markup.
    let text = cue.text;
    const offset = cue.focus ? text.toLowerCase().indexOf(cue.focus.toLowerCase()) : -1;
    if (offset >= 0) text = text.slice(0, offset) + '{\\c&H0066D9FF&\\b1}' + text.slice(offset, offset + cue.focus.length) + '{\\r}' + text.slice(offset + cue.focus.length);
    const explanation = cue.meaning ? [cue.meaning, cue.usage].filter(Boolean).join(' · ') : cue.translation;
    if (explanation) text += `\\N{\\fn${chineseFontName}\\fs22}` + subtitleLiteral(explanation);
    return `Dialogue: 0,${timestamp(cue.start)},${timestamp(cue.end)},Default,,0,0,0,,${text}`;
  });
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 854\nPlayResY: 480\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${fontName},25,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,42,42,24,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${lines.join('\n')}\n`;
}

export async function addEnglishSubtitles(buffer, brief, { execImpl, ffmpegPath = 'ffmpeg', fontPath = process.env.EDU_VIDEO_FONT_PATH, recognizeSpeech = recognizeVideoSpeech, onAligned = () => {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'zhixu-subtitles-'));
  try {
    const font = fontPath || ['/usr/share/fonts/google-noto-vf/NotoSans-VF.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf'].find(existsSync);
    if (!font) throw new Error('subtitle font unavailable');
    await mkdir(join(directory, 'fonts'));
    await copyFile(font, join(directory, 'fonts', 'English.ttf'));
    let chineseFontName = 'Noto Sans CJK SC';
    if (englishSubtitleCues(brief).some(cue => cue.meaning || cue.translation)) {
      const chineseFont = process.env.EDU_VIDEO_CJK_FONT_PATH || [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/google-noto-cjk/NotoSansCJKsc-Regular.otf',
        '/System/Library/Fonts/STHeiti Medium.ttc',
      ].find(existsSync);
      if (!chineseFont) throw new Error('Chinese subtitle font unavailable');
      await copyFile(chineseFont, join(directory, 'fonts', 'Chinese' + extname(chineseFont)));
      chineseFontName = process.env.EDU_VIDEO_CJK_FONT_NAME || (chineseFont.includes('STHeiti') ? 'Heiti SC' : 'Noto Sans CJK SC');
    }
    const fontName = font.includes('Arial') ? 'Arial' : font.includes('DejaVu') ? 'DejaVu Sans' : 'Noto Sans';
    await writeFile(join(directory, 'source.mp4'), buffer);
    const transcript = await recognizeSpeech(join(directory, 'source.mp4'), directory, { execImpl });
    const cues = alignEnglishCues(englishSubtitleCues(brief), transcript);
    await writeFile(join(directory, 'subtitles.ass'), englishSubtitleAss(brief, fontName, chineseFontName, cues));
    // Legacy footage can already contain misspelled model-rendered English.
    // Replace that reserved caption area before adding reviewed bilingual text.
    const captionBand = brief.teachingVersion ? '' : 'drawbox=x=0:y=ih*0.8:w=iw:h=ih*0.2:color=0x172128:t=fill,';
    await execImpl(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'source.mp4', '-map', '0:v:0', '-map', '0:a:0', '-vf', captionBand + 'ass=subtitles.ass:fontsdir=fonts', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'captioned.mp4'], { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    const result = await readFile(join(directory, 'captioned.mp4'));
    onAligned({ timingSource: 'audio', engine: transcript.engine || 'speech-recognition', cues: cues.map(({ text, start, end, stage }) => ({ text, start, end, stage })) });
    return result;
  } catch (error) {
    if (['VIDEO_SPEECH_ALIGNMENT_FAILED', 'VIDEO_SPEECH_RECOGNITION_FAILED'].includes(error.code)) throw error;
    throw Object.assign(new Error('英文字幕处理未完成，可重试获取原视频并添加字幕'), { code: 'VIDEO_SUBTITLES_FAILED' });
  }
  finally { await rm(directory, { recursive: true, force: true }); }
}
