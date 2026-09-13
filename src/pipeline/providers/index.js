import * as claude from './claude.js';
import * as gemini from './gemini.js';

export const PROVIDERS = { claude, gemini };
export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function resolveProvider(config) {
  const id = config?.report?.provider ?? 'claude';
  return PROVIDERS[id] ?? PROVIDERS.claude;
}

export function hasApiKey(config) {
  return resolveProvider(config).hasApiKey();
}

function resolveModel(config, provider) {
  return config?.report?.model || provider.defaultModel;
}

export async function generateNarrative(config, summary, options = {}) {
  const provider = resolveProvider(config);
  const { model, ...rest } = options;
  return provider.generateNarrative(summary, { model: model ?? resolveModel(config, provider), ...rest });
}

export async function answerQuestion(config, question, context, options = {}) {
  const provider = resolveProvider(config);
  const { model, ...rest } = options;
  return provider.answerQuestion(question, context, { model: model ?? resolveModel(config, provider), ...rest });
}
