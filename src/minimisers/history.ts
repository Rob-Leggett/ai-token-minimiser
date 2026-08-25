import type { ChatMessage } from '../types.js';
import { countMessageTokens } from '../tokenizer.js';

/**
 * Trim conversation history to fit within a token budget.
 *
 * Rules:
 *  - All system / developer messages are always retained (instructions).
 *  - The most recent non-system messages are kept until the budget is hit,
 *    walking backwards from the end so the latest turns survive.
 *  - The final message is always kept (it is usually the active user request).
 *  - `tool` messages are only kept if their preceding assistant turn survives,
 *    to avoid dangling tool responses.
 *
 * A budget of 0 disables trimming.
 */
export function trimHistory(messages: ChatMessage[], tokenBudget: number): ChatMessage[] {
  if (tokenBudget <= 0 || messages.length === 0) return messages;

  const systemIdx = new Set<number>();
  let systemTokens = 0;
  messages.forEach((m, i) => {
    if (m.role === 'system' || m.role === 'developer') {
      systemIdx.add(i);
      systemTokens += countMessageTokens(m);
    }
  });

  let remaining = tokenBudget - systemTokens;
  const keep = new Set<number>(systemIdx);

  for (let i = messages.length - 1; i >= 0; i--) {
    if (keep.has(i)) continue;
    const cost = countMessageTokens(messages[i]);
    const isLast = i === messages.length - 1;
    if (remaining - cost < 0 && !isLast) break;
    remaining -= cost;
    keep.add(i);
  }

  const trimmed = messages.filter((_, i) => keep.has(i));

  // Drop leading tool messages that lost their triggering assistant turn.
  while (trimmed.length && trimmed[0].role === 'tool') {
    trimmed.shift();
  }

  return trimmed;
}
