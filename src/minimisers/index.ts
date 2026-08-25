import type { ChatCompletionRequest, MinimiseResult } from '../types.js';
import type { Config } from '../config.js';
import { countMessagesTokens } from '../tokenizer.js';
import { stripWhitespace } from './whitespace.js';
import { dedupeMessages } from './dedupe.js';
import { trimHistory } from './history.js';

/**
 * Apply the configured minimisation strategies to a chat completion request.
 * Returns a new request plus before/after token estimates. The strategies are
 * lossless-to-meaning transforms: they never rewrite the substance of a
 * message, only remove redundancy or older context.
 */
export function minimiseRequest(
  request: ChatCompletionRequest,
  config: Config,
): MinimiseResult {
  const applied: string[] = [];
  let messages = request.messages ?? [];
  const tokensBefore = countMessagesTokens(messages);

  if (config.stripWhitespace) {
    const next = stripWhitespace(messages);
    if (countMessagesTokens(next) < countMessagesTokens(messages)) applied.push('strip-whitespace');
    messages = next;
  }

  if (config.dedupeMessages) {
    const next = dedupeMessages(messages);
    if (next.length < messages.length) applied.push('dedupe-messages');
    messages = next;
  }

  if (config.historyTokenBudget > 0) {
    const next = trimHistory(messages, config.historyTokenBudget);
    if (next.length < messages.length) applied.push('trim-history');
    messages = next;
  }

  const tokensAfter = countMessagesTokens(messages);

  return {
    request: { ...request, messages },
    tokensBefore,
    tokensAfter,
    appliedStrategies: applied,
  };
}
