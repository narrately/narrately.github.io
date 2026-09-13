import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt, buildAskPrompt, reportSystemPrompt, ASK_SYSTEM_PROMPT, lengthGuidance } from '../prompts.js';

export const id = 'claude';
export const label = 'Claude (Anthropic)';
export const defaultModel = 'claude-opus-5';

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function generateNarrative(summary, options = {}) {
  const { model = defaultModel, verbosity = 'standard', periodLabel = 'today', period = 'day', signal, diffsByProject = {} } = options;

  const client = new Anthropic();
  const userPrompt = [
    buildPrompt(summary, { verbosity, periodLabel, diffsByProject }),
    '',
    `Length guidance: ${lengthGuidance(verbosity)}`,
  ].join('\n');

  const stream = client.messages.stream(
    {
      model,
      max_tokens: 8000,
      system: reportSystemPrompt(period),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: userPrompt }],
    },
    signal ? { signal } : undefined,
  );

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined to generate this report' +
        (message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'),
    );
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude returned an empty report.');

  return { markdown: text, usage: message.usage, model: message.model };
}

export async function answerQuestion(question, context, options = {}) {
  const { model = defaultModel, signal, history = [] } = options;
  const client = new Anthropic();

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: buildAskPrompt(question, context) },
  ];

  const stream = client.messages.stream(
    {
      model,
      max_tokens: 4000,
      system: ASK_SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      messages,
    },
    signal ? { signal } : undefined,
  );

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer that question.');
  }

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude returned an empty answer.');
  return { text, usage: message.usage, model: message.model };
}
