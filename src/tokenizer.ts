import { encode } from 'gpt-tokenizer';
import type { ChatMessage, ContentPart } from './types.js';

/**
 * Approximate token count for a string. Uses the cl100k_base encoding which is
 * a good proxy across modern OpenAI / GitHub models. This is an estimate used
 * for budgeting and reporting savings, not for billing.
 */
export function countTextTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // Fallback heuristic: ~4 chars per token.
    return Math.ceil(text.length / 4);
  }
}

/** Extract the plain-text content of a message regardless of shape. */
export function messageText(message: ChatMessage): string {
  const { content } = message;
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return (content as ContentPart[])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('\n');
}

/** Per-message token overhead (role markers, delimiters). */
const PER_MESSAGE_OVERHEAD = 4;

export function countMessageTokens(message: ChatMessage): number {
  let total = PER_MESSAGE_OVERHEAD;
  total += countTextTokens(messageText(message));
  if (message.name) total += countTextTokens(message.name);
  return total;
}

export function countMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + countMessageTokens(m), 0);
}
