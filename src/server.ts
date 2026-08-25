import express, { type Request, type Response } from 'express';
import type { Config } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { minimiseRequest } from './minimisers/index.js';
import { ResponseCache } from './cache.js';
import { Metrics } from './metrics.js';
import { forwardToUpstream } from './providers/upstream.js';
import { countMessagesTokens } from './tokenizer.js';
import type { ChatCompletionRequest } from './types.js';

export interface AppDeps {
  config: Config;
  logger?: Logger;
  cache?: ResponseCache;
  metrics?: Metrics;
}

export function createApp({ config, logger, cache, metrics }: AppDeps) {
  const log = logger ?? createLogger(config.logLevel);
  const responseCache =
    cache ?? new ResponseCache(config.responseCacheTtlSeconds, config.responseCacheMaxEntries);
  const stats = metrics ?? new Metrics();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // Optional shared-secret auth for the proxy itself.
  app.use((req: Request, res: Response, next) => {
    if (req.path === '/healthz') return next();
    if (!config.proxyApiKey) return next();
    const auth = req.header('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== config.proxyApiKey) {
      return res.status(401).json({ error: { message: 'Unauthorized', type: 'auth_error' } });
    }
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', upstream: config.upstream });
  });

  app.get('/metrics', (_req, res) => {
    res.json({ ...stats.snapshot(), cacheSize: responseCache.size });
  });

  app.post('/v1/chat/completions', (req, res) => {
    void handleChatCompletion(req, res, { config, log, responseCache, stats });
  });

  // Transparent pass-through for every other OpenAI-compatible endpoint
  // (embeddings, models, responses, etc.) — forwarded unchanged.
  app.all(/^\/v1\/.*/, (req, res) => {
    void handlePassthrough(req, res, { config, log });
  });

  return { app, metrics: stats, cache: responseCache };
}

interface ChatCtx {
  config: Config;
  log: Logger;
  responseCache: ResponseCache;
  stats: Metrics;
}

async function handleChatCompletion(req: Request, res: Response, ctx: ChatCtx): Promise<void> {
  const { config, log, responseCache, stats } = ctx;
  const original = req.body as ChatCompletionRequest;

  if (!original || !Array.isArray(original.messages)) {
    res.status(400).json({ error: { message: 'Invalid request: messages[] required' } });
    return;
  }

  const { request: minimised, tokensBefore, tokensAfter, appliedStrategies } = minimiseRequest(
    original,
    config,
  );

  log.debug('minimised request', {
    tokensBefore,
    tokensAfter,
    saved: tokensBefore - tokensAfter,
    appliedStrategies,
  });

  // Serve from cache when possible (deterministic requests only).
  const cacheable = config.responseCache && ResponseCache.isCacheable(minimised);
  const cacheKey = cacheable ? ResponseCache.keyFor(minimised) : '';
  if (cacheable) {
    const hit = responseCache.get(cacheKey);
    if (hit !== undefined) {
      stats.recordCacheHit(tokensBefore);
      res.setHeader('x-token-minimiser-cache', 'HIT');
      res.setHeader('content-type', 'application/json');
      res.status(200).send(hit);
      log.info(`cache HIT — saved ~${tokensBefore} prompt tokens`);
      return;
    }
  }

  stats.record(tokensBefore, tokensAfter);
  res.setHeader('x-token-minimiser-tokens-before', String(tokensBefore));
  res.setHeader('x-token-minimiser-tokens-after', String(tokensAfter));
  res.setHeader('x-token-minimiser-strategies', appliedStrategies.join(',') || 'none');

  const headers = extractHeaders(req);
  let upstream;
  try {
    upstream = await forwardToUpstream(
      config,
      '/chat/completions',
      'POST',
      headers,
      JSON.stringify(minimised),
    );
  } catch (err) {
    log.error('upstream request failed', err);
    res.status(502).json({ error: { message: 'Upstream request failed', type: 'upstream_error' } });
    return;
  }

  copyResponseHeaders(res, upstream.headers);
  res.status(upstream.status);

  if (minimised.stream) {
    upstream.body.pipe(res);
    return;
  }

  const chunks: Buffer[] = [];
  upstream.body.on('data', (c: Buffer) => chunks.push(c));
  upstream.body.on('end', () => {
    const bodyText = Buffer.concat(chunks).toString('utf8');
    if (cacheable && upstream.status === 200) {
      responseCache.set(cacheKey, bodyText);
    }
    res.send(bodyText);
  });
  upstream.body.on('error', (err) => {
    log.error('upstream stream error', err);
    if (!res.headersSent) res.status(502);
    res.end();
  });

  void countMessagesTokens; // referenced for potential future accounting
}

async function handlePassthrough(
  req: Request,
  res: Response,
  ctx: { config: Config; log: Logger },
): Promise<void> {
  const { config, log } = ctx;
  const hasBody = req.body && Object.keys(req.body).length > 0;
  try {
    const upstream = await forwardToUpstream(
      config,
      req.path.replace(/^\/v1/, ''),
      req.method,
      extractHeaders(req),
      hasBody ? JSON.stringify(req.body) : undefined,
    );
    copyResponseHeaders(res, upstream.headers);
    res.status(upstream.status);
    upstream.body.pipe(res);
  } catch (err) {
    log.error('passthrough failed', err);
    res.status(502).json({ error: { message: 'Upstream request failed' } });
  }
}

function extractHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers[key] = value;
  }
  headers['content-type'] = 'application/json';
  return headers;
}

function copyResponseHeaders(
  res: Response,
  headers: Record<string, string | string[] | undefined>,
): void {
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (['content-length', 'transfer-encoding', 'connection'].includes(lower)) continue;
    if (value !== undefined) res.setHeader(key, value);
  }
}
