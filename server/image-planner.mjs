import { runTutor } from './tutor.mjs';

// Read only the conversation up to the reply being illustrated. Later topics
// must never replace the subject of an earlier, delayed image.
export async function planLearningImage({ session, modelId, environment, signal, runModelOverride }) {
  const context = { ...session, messages: session.messages.filter(m => !m.kind && m.status !== 'error').slice(-6) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runTutor({ session: context, modelId, environment, signal, runModelOverride,
      imagePlanning: true, memory: { topics: [] },
      text: '为最后一条已完成的学习讲解补齐一张图解方案。请判断是否需要配图，并只返回规定的JSON。' + (attempt ? '上次格式无效。需要配图返回{"needed":true,"prompt":"完整中文提示词"}；无需配图返回{"needed":false,"reason":"not_educational或declined或insufficient_information"}。' : ''),
    });
    try {
      const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (value.needed === true && typeof value.prompt === 'string' && value.prompt.trim().length >= 20 && value.prompt.length <= 12000) return { prompt: value.prompt.trim() };
      if (value.needed === false && ['not_educational', 'declined', 'insufficient_information'].includes(value.reason)) return { prompt: '', reason: value.reason };
    } catch { /* Repair once before any image generation is submitted. */ }
  }
  throw new Error('配图说明没有整理完整');
}
