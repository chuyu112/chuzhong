import test from 'node:test';
import assert from 'node:assert/strict';
import { nicknameFromMessage, welcomeMessage } from '../dist/onboarding.js';

test('nickname memory accepts introductions without interpreting questions or homework as names', () => {
 assert.equal(nicknameFromMessage('叫我小禾'), '小禾');
 assert.equal(nicknameFromMessage('我叫 Alex'), 'Alex');
 assert.equal(nicknameFromMessage('小禾', true), '小禾');
 assert.equal(nicknameFromMessage('小禾', false), null);
 for (const value of ['你好小直', '我不会', '讲个笑话', '一元一次方程', '我不想说', '为什么', '数学', '帮我看作业', '3x+5=20', '19900000000', '我叫小禾，帮我做题', '<script>']) assert.equal(nicknameFromMessage(value, true), null, value);
 assert.match(welcomeMessage({}, '小星'), /我是小星/);
 assert.match(welcomeMessage({}), /昵称/);
 assert.doesNotMatch(welcomeMessage({nicknameAsked:true}), /昵称/);
 assert.match(welcomeMessage({displayName:'小禾'}), /小禾，你好呀/);
});
