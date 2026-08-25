import { createHash } from 'node:crypto';
import type { ChatCompletionRequest } from './types.js';

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * A tiny in-memory TTL + LRU cache for deterministic responses.
 *
 * Only requests that are deterministic (temperature 0 and not streaming) are
 * cacheable, so identical requests can skip the upstream call entirely — the
 * biggest possible token saving. Nothing is persisted to disk, so no prompt or
 * response data outlives the process.
 */
export class ResponseCache {
  private store = new Map<string, Entry>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly maxEntries: number,
  ) {}

  static isCacheable(request: ChatCompletionRequest): boolean {
    if (request.stream) return false;
    const temp = request.temperature ?? 1;
    return temp === 0;
  }

  static keyFor(request: ChatCompletionRequest): string {
    const canonical = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 1,
      top_p: request.top_p ?? 1,
      seed: request.seed ?? null,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  get(key: string): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU ordering.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  get size(): number {
    return this.store.size;
  }
}
