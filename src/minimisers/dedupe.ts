import type { ChatMessage } from '../types.js';
import { messageText } from '../tokenizer.js';

/**
 * Remove exact-duplicate non-system messages. Large contexts frequently repeat
 * identical file snippets or instructions; sending them once is enough.
 *
 * The FIRST occurrence is kept in place. System / developer messages are never
 * removed because their position and repetition can be semantically meaningful.
 * Very short messages (< 40 chars) are ignored to avoid collapsing normal
 * conversational turns like "yes" / "continue".
 */
const MIN_LENGTH = 40;

export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      result.push(message);
      continue;
    }
    const text = messageText(message);
    const key = `${message.role}:${text}`;
    if (text.length >= MIN_LENGTH && seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(message);
  }

  return result;
}
