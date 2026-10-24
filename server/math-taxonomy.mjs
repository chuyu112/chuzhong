import { readFileSync } from 'node:fs';

const curriculum = JSON.parse(readFileSync(new URL('../vendor/cn-math-taxonomy/curriculum.json', import.meta.url), 'utf8'));
export const MATH_TAXONOMY_VERSION = curriculum.commit;
const topics = new Map(curriculum.topics.map(topic => [topic.id, topic]));
const prereqs = new Map(curriculum.topics.map(topic => [topic.id, []]));
for (const edge of curriculum.dependencies) prereqs.get(edge.topicId).push(edge);
export const mathTopic = id => topics.get(id) || null;
export function mathTopicDetails(id) {
  const topic = mathTopic(id);
  if (!topic) return null;
  return { ...topic, prerequisites: prereqs.get(id).map(edge => ({ id: edge.prerequisiteId, name: topics.get(edge.prerequisiteId).name, strength: edge.strength, reason: edge.reason })), sourceVersion: MATH_TAXONOMY_VERSION, reviewStatus: curriculum.reviewStatus };
}
const normalize = text => String(text).toLowerCase().replace(/[\s，。？！、：；,.?!:;()（）]/g, '');
const grams = text => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
export function searchMathTopics(query, limit = 8) {
  if (topics.has(query)) return [mathTopicDetails(query)];
  const key = normalize(query).slice(0, 120), tokens = grams(key);
  if (!key) return [];
  return [...topics.values()].map(topic => {
    const name = normalize(topic.name), description = normalize(topic.description), nameTokens = grams(name);
    let score = name === key ? 100 : name.includes(key) ? 50 : key.includes(name) ? 40 : 0;
    for (const token of tokens) { if (nameTokens.has(token)) score += 4; else if (description.includes(token)) score += 0.5; }
    return { topic, score: score * (topic.grade >= 7 ? 1.2 : 1) };
  }).filter(row => row.score >= 4).sort((a, b) => b.score - a.score).slice(0, Math.min(limit, 12)).map(({ topic }) => mathTopicDetails(topic.id));
}

export function mathPrerequisitePath(id, depth = 2) {
  const visited = new Set([id]), path = [];
  function visit(topicId, level) {
    if (!level) return;
    for (const edge of prereqs.get(topicId) || []) {
      if (visited.has(edge.prerequisiteId)) continue;
      visited.add(edge.prerequisiteId);
      path.push({ from: topicId, id: edge.prerequisiteId, name: mathTopic(edge.prerequisiteId).name, strength: edge.strength, reason: edge.reason });
      visit(edge.prerequisiteId, level - 1);
    }
  }
  visit(id, Math.min(depth, 3)); return path.slice(0, 15);
}
