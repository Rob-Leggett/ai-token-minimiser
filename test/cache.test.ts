import { describe, it, expect } from 'vitest';
import { ResponseCache } from '../src/cache.js';
import { Metrics } from '../src/metrics.js';
import type { ChatCompletionRequest } from '../src/types.js';

const base: ChatCompletionRequest = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
};

describe('ResponseCache', () => {
  it('only caches deterministic, non-streaming requests', () => {
    expect(ResponseCache.isCacheable(base)).toBe(true);
    expect(ResponseCache.isCacheable({ ...base, temperature: 0.7 })).toBe(false);
    expect(ResponseCache.isCacheable({ ...base, stream: true })).toBe(false);
  });

  it('produces stable keys for identical requests', () => {
    expect(ResponseCache.keyFor(base)).toBe(ResponseCache.keyFor({ ...base }));
  });

  it('stores and retrieves within TTL', () => {
    const c = new ResponseCache(60, 10);
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
  });

  it('expires entries after TTL', () => {
    const c = new ResponseCache(-1, 10); // already expired
    c.set('k', 'v');
    expect(c.get('k')).toBeUndefined();
  });

  it('evicts oldest entry when over capacity (LRU)', () => {
    const c = new ResponseCache(60, 2);
    c.set('a', '1');
    c.set('b', '2');
    c.get('a'); // touch a so b is oldest
    c.set('c', '3');
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe('1');
    expect(c.get('c')).toBe('3');
  });
});

describe('Metrics', () => {
  it('computes cumulative savings and percentage', () => {
    const m = new Metrics();
    m.record(100, 60);
    m.record(100, 80);
    const s = m.snapshot();
    expect(s.requests).toBe(2);
    expect(s.tokensSaved).toBe(60);
    expect(s.savingsPercent).toBe(30);
  });

  it('counts cache hits as full savings', () => {
    const m = new Metrics();
    m.recordCacheHit(200);
    const s = m.snapshot();
    expect(s.cacheHits).toBe(1);
    expect(s.tokensBefore).toBe(200);
    expect(s.tokensAfter).toBe(0);
  });
});
