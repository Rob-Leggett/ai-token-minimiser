import { describe, it, expect } from 'vitest';
import { stripWhitespaceText, stripWhitespace } from '../src/minimisers/whitespace.js';
import { dedupeMessages } from '../src/minimisers/dedupe.js';
import { trimHistory } from '../src/minimisers/history.js';
import { minimiseRequest } from '../src/minimisers/index.js';
import { loadConfig } from '../src/config.js';
import type { ChatMessage } from '../src/types.js';

describe('stripWhitespaceText', () => {
  it('collapses 3+ blank lines to one and trims trailing spaces', () => {
    const input = 'line1   \n\n\n\nline2\t\n';
    expect(stripWhitespaceText(input)).toBe('line1\n\nline2');
  });

  it('preserves single blank lines and indentation', () => {
    const input = 'def f():\n    return 1\n\n    # note';
    expect(stripWhitespaceText(input)).toBe('def f():\n    return 1\n\n    # note');
  });

  it('never adds tokens', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'a   \n\n\n\nb' }];
    const out = stripWhitespace(msgs);
    expect((out[0].content as string).length).toBeLessThan(
      (msgs[0].content as string).length,
    );
  });
});

describe('dedupeMessages', () => {
  it('removes exact duplicate long user messages but keeps first', () => {
    const dup = 'x'.repeat(50);
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: dup },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: dup },
    ];
    const out = dedupeMessages(msgs);
    expect(out).toHaveLength(3);
    expect(out.filter((m) => m.content === dup)).toHaveLength(1);
  });

  it('keeps short repeated messages (e.g. "continue")', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: 'continue' },
    ];
    expect(dedupeMessages(msgs)).toHaveLength(3);
  });

  it('never removes system messages even if duplicated', () => {
    const s = 'system prompt that is quite long and repeated here twice ok';
    const msgs: ChatMessage[] = [
      { role: 'system', content: s },
      { role: 'system', content: s },
    ];
    expect(dedupeMessages(msgs)).toHaveLength(2);
  });
});

describe('trimHistory', () => {
  it('always keeps system messages and the last message', () => {
    const big = 'word '.repeat(400);
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'keep me' },
      { role: 'user', content: big },
      { role: 'assistant', content: big },
      { role: 'user', content: 'latest question' },
    ];
    const out = trimHistory(msgs, 50);
    expect(out[0].content).toBe('keep me');
    expect(out[out.length - 1].content).toBe('latest question');
    expect(out.length).toBeLessThan(msgs.length);
  });

  it('is a no-op when budget is 0', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    expect(trimHistory(msgs, 0)).toBe(msgs);
  });
});

describe('minimiseRequest', () => {
  it('reduces token count and reports strategies', () => {
    const config = loadConfig({ MINIMISE_PRESET: 'balanced', HISTORY_TOKEN_BUDGET: '30' });
    const dup = 'repeated context block '.repeat(10);
    const req = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'sys   \n\n\n\n' },
        { role: 'user', content: dup },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: dup },
        { role: 'user', content: 'final' },
      ] as ChatMessage[],
    };
    const result = minimiseRequest(req, config);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.appliedStrategies.length).toBeGreaterThan(0);
    expect(result.request.messages[0].role).toBe('system');
  });
});
