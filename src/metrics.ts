/**
 * Cumulative metrics for token savings across the process lifetime.
 * Everything here is aggregate — no prompt/response content is retained.
 */
export interface MetricsSnapshot {
  requests: number;
  cacheHits: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  savingsPercent: number;
}

export class Metrics {
  private requests = 0;
  private cacheHits = 0;
  private tokensBefore = 0;
  private tokensAfter = 0;

  record(before: number, after: number): void {
    this.requests += 1;
    this.tokensBefore += before;
    this.tokensAfter += after;
  }

  recordCacheHit(before: number): void {
    this.requests += 1;
    this.cacheHits += 1;
    this.tokensBefore += before;
    // A cache hit sends nothing upstream.
  }

  snapshot(): MetricsSnapshot {
    const saved = this.tokensBefore - this.tokensAfter;
    return {
      requests: this.requests,
      cacheHits: this.cacheHits,
      tokensBefore: this.tokensBefore,
      tokensAfter: this.tokensAfter,
      tokensSaved: saved,
      savingsPercent:
        this.tokensBefore > 0 ? Math.round((saved / this.tokensBefore) * 1000) / 10 : 0,
    };
  }
}
