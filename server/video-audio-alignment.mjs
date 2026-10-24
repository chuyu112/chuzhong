import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const contractions = { "it's": 'it is', "that's": 'that is', "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', cannot: 'can not', "couldn't": 'could not', "wouldn't": 'would not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not', "I'm": 'i am', "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "I've": 'i have', "i've": 'i have', "hadn't": 'had not', "I'll": 'i will', "i'll": 'i will', "we'll": 'we will', "let's": 'let us' };
const tokens = value => (String(value).toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)*/g) || []).flatMap(word => (contractions[word] || word).split(' '));
const alignmentError = () => Object.assign(new Error('成片发音与脚本未能可靠对齐，暂不添加可能错位的字幕。'), { code: 'VIDEO_SPEECH_ALIGNMENT_FAILED' });

export function alignEnglishCues(cues, transcript) {
  if (!Array.isArray(transcript?.words) || transcript.words.length > 300 || !cues.length || !Number.isFinite(transcript.duration) || transcript.duration <= 0 || transcript.duration > 31) throw alignmentError();
  let previous = 0;
  for (const word of transcript.words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous - .05 || word.end <= word.start || word.end > 31 || !Number.isFinite(word.probability)) throw alignmentError();
    previous = word.end;
  }
  const expected = cues.flatMap((cue, cueIndex) => tokens(cue.text).map(token => ({ token, cueIndex })));
  const spoken = transcript.words.flatMap((word, wordIndex) => tokens(word.word).map(token => ({ token, wordIndex })));
  if (!expected.length || expected.length > 180 || !spoken.length) throw alignmentError();
  // Ordered LCS handles punctuation, contractions and small interjections while
  // keeping repeated phrases tied to their actual occurrence in the audio.
  const dp = Array.from({ length: expected.length + 1 }, () => new Uint16Array(spoken.length + 1));
  for (let i = expected.length - 1; i >= 0; i--) for (let j = spoken.length - 1; j >= 0; j--) dp[i][j] = expected[i].token === spoken[j].token ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  if (dp[0][0] !== expected.length || spoken.length - expected.length > Math.max(2, expected.length * .08)) throw alignmentError();
  const groups = cues.map(() => []);
  for (let i = 0, j = 0; i < expected.length && j < spoken.length;) {
    if (expected[i].token === spoken[j].token) { groups[expected[i].cueIndex].push(transcript.words[spoken[j].wordIndex]); i++; j++; }
    else if (dp[i + 1][j] > dp[i][j + 1]) i++;
    else j++;
  }
  const aligned = cues.map((cue, index) => {
    const words = [...new Set(groups[index])];
    if (!words.length || words.some(word => word.probability < .08) || words.reduce((sum, word) => sum + word.probability, 0) / words.length < .45) throw alignmentError();
    return { ...cue, start: words[0].start, end: words.at(-1).end, timingSource: 'audio', words: words.map(({ word, start, end }) => ({ word, start, end })) };
  });
  for (let i = 0; i < aligned.length; i++) {
    if (i && aligned[i].start < aligned[i - 1].end - .05) throw alignmentError();
    // Brief reading pause after a chunk; never keep the previous subtitle over
    // the next spoken phrase or over an unrelated scene.
    aligned[i].end = Math.min(aligned[i].end + (aligned[i].meaning ? .25 : .12), aligned[i + 1]?.start ?? transcript.duration, 30);
  }
  return aligned;
}

let queue = Promise.resolve();
export async function recognizeVideoSpeech(file, directory, { execImpl, pythonPath = process.env.EDU_VIDEO_ASR_PYTHON || '/opt/zhixu-study/asr-venv/bin/python', modelPath = process.env.EDU_VIDEO_ASR_MODEL || '/opt/zhixu-study/asr-models/base.en' } = {}) {
  const run = async () => {
    const output = join(directory, 'speech-timing.json');
    await execImpl(pythonPath, [fileURLToPath(new URL('../scripts/align-video-speech.py', import.meta.url)), file, output, '--model', modelPath], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    return JSON.parse(await readFile(output, 'utf8'));
  };
  const pending = queue.then(run, run); queue = pending.catch(() => {});
  try { return await pending; } catch { throw Object.assign(new Error('视频音轨识别未完成，可重新处理原视频'), { code: 'VIDEO_SPEECH_RECOGNITION_FAILED' }); }
}
