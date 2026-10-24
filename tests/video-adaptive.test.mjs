import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectVideoBrief, validateVideoBrief, buildVideoPrompt, englishWords, validateEnglishReview } from '../server/video-prompt.mjs';
import { alignEnglishCues } from '../server/video-audio-alignment.mjs';
import { englishSubtitleAss, englishSubtitleCues } from '../server/video-subtitles.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/english-roleplay-adaptive.json', import.meta.url), 'utf8'));
const inspect = value => inspectVideoBrief(`<learning-video>${JSON.stringify(value)}</learning-video>`, { scheduleDraft: true });

test('content determines scene lengths, preserving the original exchange and adding a distinct example', () => {
  const { brief, issue } = inspect(fixture);
  assert.ok(brief, issue);
  assert.doesNotThrow(() => validateEnglishReview(brief));
  assert.equal(brief.timingEstimate.words, 70);
  assert.ok(brief.timingEstimate.speechAndTurnSeconds >= 26);
  assert.equal(brief.scenes.reduce((sum, scene) => sum + scene.seconds, 0), 30);
  assert.ok(brief.scenes[0].seconds > 20);
  assert.deepEqual(brief.scenes[0].dialogue.map(l => l.text), fixture.scenes[0].dialogue.map(l => l.text));
  assert.equal(brief.scenes[2].stage, 'example');
  for (const scene of brief.scenes) for (const line of scene.dialogue) {
    const rate = englishWords(line.text).length * 60 / (line.end - line.start);
    assert.ok(line.delivery === 'clear' ? rate >= 144 && rate <= 146 : rate >= 159 && rate <= 161);
  }
  const prompt = buildVideoPrompt(brief);
  assert.ok(prompt.length < 3000);
  assert.doesNotMatch(prompt, /90—110|6—15秒|逐词慢读/);
  assert.ok(englishSubtitleCues(brief).some(cue => cue.meaning === '有道理的观点'));
});

test('new lessons explain the key point before one clear reprise of the original expression', () => {
  const approved = inspect(fixture).brief;
  const reviews = approved.scenes[1].dialogue;
  assert.equal(reviews[0].focus, reviews[1].focus);
  assert.equal(reviews[1].text, "That's a fair point.");
  for (const mutate of [
    brief => brief.scenes[1].dialogue.reverse(),
    brief => brief.scenes[1].dialogue[1].delivery = 'natural',
    brief => brief.scenes[1].dialogue[1].text = 'The weather is lovely.',
    brief => brief.scenes[1].dialogue.push({ ...brief.scenes[1].dialogue[1] }),
    brief => brief.scenes.splice(1, 1),
  ]) {
    const invalid = structuredClone(approved); mutate(invalid);
    assert.throws(() => validateEnglishReview(invalid), undefined, mutate.toString());
  }
});

test('older single-scene v3 remains readable but new planning requires key-point review', () => {
  const draft = structuredClone(fixture);
  draft.scenes[0].dialogue = draft.scenes.flatMap(scene => scene.dialogue).map(line => ({ ...line, delivery: 'natural' }));
  draft.scenes = [draft.scenes[0]];
  const result = inspect(draft);
  assert.ok(result.brief, result.issue);
  assert.equal(result.brief.scenes.length, 1);
  assert.equal(result.brief.scenes[0].seconds, 30);
  assert.throws(() => validateEnglishReview(result.brief), /先用breakdown/);
});

test('slightly fuller content stays within natural conversational speed and can embed the target sentence', () => {
  const draft = structuredClone(fixture);
  draft.targetSentence = "I don't think the school trip is worth the money.";
  draft.scenes[2].dialogue[0].text += ' We can save money for lab supplies.';
  const { brief, issue } = inspect(draft);
  assert.ok(brief, issue);
  assert.ok(brief.timingEstimate.speechAndTurnSeconds < 30);
  for (const scene of brief.scenes) for (const line of scene.dialogue) {
    const rate = englishWords(line.text).length * 60 / (line.end - line.start);
    assert.ok(line.delivery === 'clear' ? rate >= 144 && rate <= 146 : rate >= 169 && rate <= 171);
  }
});

test('short content requests a new example; stretching speech does not satisfy the budget', () => {
  const draft = structuredClone(fixture);
  draft.scenes = [draft.scenes[0]];
  draft.scenes[0].dialogue = draft.scenes[0].dialogue.slice(0, 1).concat({ ...draft.scenes[0].dialogue[1], text: 'I agree.', translation: '我同意。' });
  draft.scenes[0].seconds = 30;
  draft.scenes[0].dialogue[0].end = 25;
  const result = inspect(draft);
  assert.equal(result.brief, null);
  assert.match(result.issue, /补新的相关例子/);
  const approved = inspect(fixture).brief;
  approved.scenes[2].dialogue[0].end = approved.scenes[2].dialogue[1].start;
  assert.throws(() => validateVideoBrief(approved), /自然语速/);
});

test('overlong content must be edited instead of rushed, and full dialogue replay is rejected', () => {
  const long = structuredClone(fixture);
  long.scenes[1].dialogue[0].text = Array(100).fill('Hello').join(' ');
  assert.match(inspect(long).issue, /超过30秒/);
  const replay = structuredClone(fixture);
  replay.scenes[0].dialogue = replay.scenes[0].dialogue.slice(0, 2);
  replay.targetSentence = replay.scenes[0].dialogue[0].text;
  replay.scenes[0].dialogue[1].text = 'I see what you mean, but it is a good chance to learn.';
  replay.scenes[1].dialogue = structuredClone(replay.scenes[0].dialogue);
  replay.scenes[1].stage = 'breakdown';
  replay.scenes = replay.scenes.slice(0, 2);
  // Add enough distinct words to the first exchange so timing passes first.
  replay.scenes[0].dialogue[0].text += ' It costs a lot for me right now.';
  replay.targetSentence = replay.scenes[0].dialogue[0].text;
  replay.scenes[1].dialogue = structuredClone(replay.scenes[0].dialogue);
  assert.match(inspect(replay).issue, /不能把同一完整对话重复/);
  const slow = structuredClone(fixture); slow.scenes[1].stage = 'slow';
  assert.match(inspect(slow).issue, /不重演整段对话/);
});

const words = (text, offset) => text.split(' ').map((word, i) => ({ word, start: offset + i * .3, end: offset + i * .3 + .25, probability: .98 }));
test('subtitles use actual speech boundaries rather than guessed scene times', () => {
  const cues = [{ text: 'I agree.', translation: '我同意。', start: 0, end: 1 }, { text: 'I agree.', translation: '我同意。', start: 6, end: 8 }];
  const actual = alignEnglishCues(cues, { duration: 30, words: [...words('I agree.', 1.2), ...words('I agree.', 10.1)] });
  assert.deepEqual(actual.map(cue => cue.start), [1.2, 10.1]);
  assert.match(englishSubtitleAss(null, 'Arial', 'Heiti SC', actual), /0:00:01.20,0:00:01.87/);
  assert.ok(actual.every(cue => cue.timingSource === 'audio'));
});

test('recognition tolerates equivalent contractions but refuses missing or untrustworthy speech', () => {
  const cues = [{ text: "It's worth it.", start: 0, end: 1 }];
  assert.equal(alignEnglishCues(cues, { duration: 30, words: words('It is worth it.', 2) })[0].start, 2);
  for (const transcript of [
    { duration: 30, words: words('It is it.', 2) },
    { duration: 30, words: words('It is worth it.', 2).map(word => ({ ...word, probability: .1 })) },
    { duration: 30, words: [] },
    { duration: 30, words: words('It is worth it.', 2).reverse() },
  ]) assert.throws(() => alignEnglishCues(cues, transcript), { code: 'VIDEO_SPEECH_ALIGNMENT_FAILED' });
});
