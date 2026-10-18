import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { textModels, resolveTextModel, textModelSupportsDirectImageInput } from '../vendor/cuiyi/lib/model-catalog.ts';
import { providerConfig } from '../vendor/cuiyi/runner/text-runtime.mjs';

// Read only model-related configuration. Never copy production tokens, storage,
// employee identities or database credentials into this independent application.
export function loadModelEnvironment(source = process.env.CUIYI_SOURCE_DIR || resolve('..', '..', '翠易导演台')) {
  const environment = {};
  const permitted = /^(GLM_|KIMI_|JIEKOU_|DEEPSEEK_|DOUBAO_(?!TTS_)|ARK_API_KEY$|OPENAI_|GEMINI_|QWEN_|DASHSCOPE_|KONJAC_)/;
  for (const file of ['.env.runner', '.env.local', '.env.jiekou.local']) {
    try {
      const values = parseEnv(readFileSync(resolve(source, file), 'utf8'));
      for (const [key, value] of Object.entries(values)) if (permitted.test(key)) environment[key] = value;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const [key, value] of Object.entries(process.env)) if (permitted.test(key)) environment[key] = value;
  return environment;
}

export function availableModels(environment) {
  return textModels.map(({ id, label }) => {
    const internalId = resolveTextModel(id);
    const provider = providerConfig(internalId, environment);
    return { id, label, configured: Boolean(provider?.key && provider?.url), vision: textModelSupportsDirectImageInput(internalId) };
  });
}
