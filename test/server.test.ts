import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MockAgent, setGlobalDispatcher } from 'undici';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';

let mockAgent: MockAgent;

beforeAll(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterAll(async () => {
  await mockAgent.close();
});

function buildApp() {
  const config = loadConfig({
    UPSTREAM: 'openai',
    UPSTREAM_BASE_URL: 'https://api.openai.com/v1',
    UPSTREAM_API_KEY: 'test-key',
    MINIMISE_PRESET: 'balanced',
    HISTORY_TOKEN_BUDGET: '0',
    LOG_LEVEL: 'silent',
  });
  return createApp({ config });
}

describe('server', () => {
  it('responds to /healthz', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('minimises and forwards chat completions, reporting savings headers', async () => {
    const pool = mockAgent.get('https://api.openai.com');
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, { id: 'cmpl-1', choices: [{ message: { content: 'hi' } }] }, {
        headers: { 'content-type': 'application/json' },
      });

    const { app } = buildApp();
    const dup = 'a very long repeated context block goes here to be deduped';
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: dup },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: dup },
          { role: 'user', content: 'final' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cmpl-1');
    expect(res.headers['x-token-minimiser-tokens-before']).toBeDefined();
    expect(Number(res.headers['x-token-minimiser-tokens-after'])).toBeLessThan(
      Number(res.headers['x-token-minimiser-tokens-before']),
    );
    expect(res.headers['x-token-minimiser-strategies']).toContain('dedupe');
  });

  it('serves deterministic requests from cache on the second call', async () => {
    const pool = mockAgent.get('https://api.openai.com');
    pool
      .intercept({ path: '/v1/chat/completions', method: 'POST' })
      .reply(200, { id: 'cached-1', choices: [] }, {
        headers: { 'content-type': 'application/json' },
      });

    const { app } = buildApp();
    const payload = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'deterministic hello' }],
      temperature: 0,
    };

    const first = await request(app).post('/v1/chat/completions').send(payload);
    expect(first.status).toBe(200);
    expect(first.headers['x-token-minimiser-cache']).toBeUndefined();

    // Second identical call should hit cache — no second upstream interceptor set up,
    // so if it went upstream it would fail with a connect error.
    const second = await request(app).post('/v1/chat/completions').send(payload);
    expect(second.status).toBe(200);
    expect(second.headers['x-token-minimiser-cache']).toBe('HIT');
    expect(second.body.id).toBe('cached-1');
  });

  it('rejects unauthorized callers when PROXY_API_KEY is set', async () => {
    const config = loadConfig({
      UPSTREAM_API_KEY: 'k',
      PROXY_API_KEY: 'secret',
      LOG_LEVEL: 'silent',
    });
    const { app } = createApp({ config });
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('authorization', 'Bearer wrong')
      .send({ model: 'x', messages: [] });
    expect(res.status).toBe(401);
  });
});
