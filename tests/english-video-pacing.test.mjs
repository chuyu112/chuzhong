import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateVideoBrief, buildVideoPrompt } from '../server/video-prompt.mjs';

const brief = JSON.parse(await readFile(new URL('./fixtures/english-roleplay.json', import.meta.url), 'utf8'));

test('word analysis rejects stretching one word across an observation pause', () => {
  assert.doesNotThrow(() => validateVideoBrief(brief));
  const invalid = structuredClone(brief);
  const word = invalid.scenes[2].dialogue[0];
  word.end = word.start + 2.5;
  assert.throws(() => validateVideoBrief(invalid), /单词发音时间过长.*不能拖音/);
});

test('pronunciation can finish before the next word while the shot continues', () => {
  const withPause = structuredClone(brief);
  const word = withPause.scenes[2].dialogue[0];
  word.end = word.start + 0.8;
  assert.doesNotThrow(() => validateVideoBrief(withPause));
  assert.match(buildVideoPrompt(withPause), /不拉长元音.*不逐音节拖读/);
});
