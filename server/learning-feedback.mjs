const normalize = value => String(value).replace(/\s+/g, '').normalize('NFKC');

// Only a model-checked, quoted part of this turn can trigger a celebration.
// Keep the control metadata out of the student's reply and stored message text.
export function parseLearningFeedback(raw, studentText, messages = []) {
  const markers = [...String(raw).matchAll(/<learning-feedback>([\s\S]*?)<\/learning-feedback>/gi)];
  const text = String(raw).replace(/<learning-feedback>[\s\S]*?(?:<\/learning-feedback>|$)/gi, '').trim();
  if (!text || markers.length !== 1) return { text, feedback: null };
  try {
    const value = JSON.parse(markers[0][1]);
    if (!['correct_step', 'correct_answer'].includes(value.kind) || typeof value.evidence !== 'string') return { text, feedback: null };
    const evidence = normalize(value.evidence);
    if (!evidence || evidence.length > 500 || !normalize(studentText).includes(evidence)) return { text, feedback: null };
    if (/^(?:我|这题|这道题)?(?:做对了|答对了|会了|懂了|明白了|谢谢|放礼花|放音乐)[!！。]*$/.test(evidence)) return { text, feedback: null };
    if (messages.some(m => m.feedback && normalize(m.feedback.evidence) === evidence)) return { text, feedback: null };
    return { text, feedback: { kind: value.kind, evidence: value.evidence.trim() } };
  } catch { return { text, feedback: null }; }
}

export function practiceEncouragement(attempt, previous) {
  if (!attempt.correct) return '这次答案还需要调整。谢谢你把自己的尝试写出来，我们一起找到卡住的那一步。';
  if (previous.some(a => a.questionId === attempt.questionId && !a.correct)) return '做对啦！这道题你之前还没答对，这次已经把答案修正了，这份进步值得开心一下！';
  if (attempt.support !== 'none') return '做对啦！借助提示完成这道题也是进步。接下来可以试试不用提示，你已经迈出了一步！';
  return '答对啦！这道题的答案核对正确，给自己一个小小的庆祝吧！';
}
