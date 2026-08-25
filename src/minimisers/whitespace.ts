import type { ChatMessage, ContentPart } from '../types.js';

/**
 * Collapse redundant whitespace inside message content without changing meaning:
 *  - strip trailing spaces on each line
 *  - collapse 3+ consecutive blank lines into a single blank line
 *  - trim leading/trailing blank lines
 *
 * This is intentionally conservative so it stays safe for code and prose alike:
 * indentation and single blank lines (which are significant in some languages
 * and in Markdown) are preserved.
 */
export function stripWhitespaceText(text: string): string {
  return text
    .replace(/[ \t]+(\r?\n)/g, '$1')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/\s+$/, '');
}

function applyToContent(content: ChatMessage['content']): ChatMessage['content'] {
  if (content == null) return content;
  if (typeof content === 'string') return stripWhitespaceText(content);
  return (content as ContentPart[]).map((part) =>
    typeof part.text === 'string' ? { ...part, text: stripWhitespaceText(part.text) } : part,
  );
}

export function stripWhitespace(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, content: applyToContent(m.content) }));
}
