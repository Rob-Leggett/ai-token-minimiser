# ai-token-minimiser

An **OpenAI-compatible proxy** that sits between your AI clients and the upstream
provider (OpenAI, GitHub Models / Copilot, or any compatible gateway) and
**reduces the number of tokens** sent upstream — lowering cost and latency
without changing the meaning of your prompts.

Point any OpenAI-compatible client at this proxy's base URL and it will:

- **Strip redundant whitespace** (trailing spaces, 3+ blank lines) from messages.
- **Deduplicate** identical large message blocks within a single request.
- **Trim conversation history** to a configurable token budget while always
  keeping system instructions and the latest turn.
- **Cache deterministic responses** (`temperature: 0`, non-streaming) so
  identical requests skip the upstream call entirely.
- **Report savings** via response headers and a `/metrics` endpoint.

Every transformation is *lossless to meaning*: the proxy only removes
redundancy or older context — it never rewrites the substance of a message.

> [!IMPORTANT]
> **Privacy first.** This is designed to run **locally**. No prompt or response
> content is ever written to disk or sent anywhere except your chosen upstream.
> The response cache is in-memory only and dies with the process. Secrets live
> in a git-ignored `.env` file — never in the repository. See
> [Security & privacy](#security--privacy).

---

## Table of contents

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Minimisation strategies & presets](#minimisation-strategies--presets)
- [API](#api)
- [Connecting clients](#connecting-clients)
- [OpenAPI & Postman](#openapi--postman)
- [Security & privacy](#security--privacy)
- [Development](#development)

---

## How it works

```
┌────────────┐      ┌───────────────────────┐      ┌──────────────────┐
│  Your app  │      │  ai-token-minimiser   │      │  Upstream API     │
│  / Copilot │─────▶│  /v1/chat/completions │─────▶│  OpenAI /         │
│  / OpenAI  │◀─────│  • strip whitespace   │◀─────│  GitHub Models    │
│  SDK       │      │  • dedupe messages    │      │  / custom gateway │
└────────────┘      │  • trim history       │      └──────────────────┘
                    │  • cache (temp=0)     │
                    │  • report savings     │
                    └───────────────────────┘
```

The proxy speaks the OpenAI REST dialect. `POST /v1/chat/completions` is
minimised; every other `/v1/*` route (embeddings, models, etc.) is forwarded
untouched.

## Quick start

Requires **Node.js 26** (see `.nvmrc`; npm 11). Install scripts are limited to the packages allow-listed under `allowScripts` in `package.json` (`esbuild`, `fsevents`).

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#   edit .env → set UPSTREAM_API_KEY (and UPSTREAM / UPSTREAM_BASE_URL if not OpenAI)

# 3. Run
npm run build && npm start
#   or, for live-reload during development:
npm run dev
```

You should see:

```
ai-token-minimiser listening on http://127.0.0.1:8787 → upstream openai (https://api.openai.com/v1) [preset: balanced]
```

Verify it's up:

```bash
curl http://127.0.0.1:8787/healthz
# {"status":"ok","upstream":"openai"}
```

Send a chat completion (note the base URL points at the proxy):

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }' -i
```

The response includes savings headers:

```
x-token-minimiser-tokens-before: 42
x-token-minimiser-tokens-after: 39
x-token-minimiser-strategies: strip-whitespace
```

## Configuration

All configuration is via environment variables (loaded from `.env`). Copy
[`.env.example`](.env.example) and edit. Explicit variables always override the
preset defaults.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Port the proxy listens on. |
| `HOST` | `127.0.0.1` | Bind address. Keep it loopback unless you know what you're doing. |
| `UPSTREAM` | `openai` | `openai` \| `github-models` \| `custom`. Selects a default base URL. |
| `UPSTREAM_BASE_URL` | `https://api.openai.com/v1` | Upstream base URL. Override for Azure/self-hosted/gateways. |
| `UPSTREAM_API_KEY` | *(empty)* | Key used upstream. If empty, the caller's own `Authorization` header is passed through. |
| `PROXY_API_KEY` | *(empty)* | Optional shared secret. If set, callers must send it as their Bearer token. |
| `MINIMISE_PRESET` | `balanced` | `off` \| `safe` \| `balanced` \| `aggressive`. Seeds the toggles below. |
| `HISTORY_TOKEN_BUDGET` | `6000` | Max tokens of history to keep (system messages always kept). `0` disables. |
| `STRIP_WHITESPACE` | `true` | Collapse redundant whitespace. |
| `DEDUPE_MESSAGES` | `true` | Remove duplicate large message blocks. |
| `RESPONSE_CACHE` | `true` | Cache deterministic responses. |
| `RESPONSE_CACHE_TTL_SECONDS` | `3600` | Cache entry lifetime. |
| `RESPONSE_CACHE_MAX_ENTRIES` | `500` | Max cache entries (LRU eviction). |
| `LOG_LEVEL` | `info` | `silent` \| `error` \| `info` \| `debug`. |

### Known upstreams

| `UPSTREAM` | Default base URL | Auth |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | OpenAI API key |
| `github-models` | `https://models.github.ai/inference` | GitHub token with the `models` scope |
| `custom` | *(set `UPSTREAM_BASE_URL`)* | Provider-specific |

## Minimisation strategies & presets

| Preset | strip whitespace | dedupe | history budget | cache |
| --- | --- | --- | --- | --- |
| `off` | – | – | disabled | – |
| `safe` | ✓ | ✓ | disabled | – |
| `balanced` *(default)* | ✓ | ✓ | 6000 | ✓ |
| `aggressive` | ✓ | ✓ | 3000 | ✓ |

Strategy details:

- **`strip-whitespace`** — removes trailing spaces per line, collapses 3+ blank
  lines to one, and trims leading/trailing blank lines. Indentation and single
  blank lines (significant in code and Markdown) are preserved.
- **`dedupe-messages`** — drops exact-duplicate non-system messages ≥ 40 chars,
  keeping the first occurrence. System/developer messages are never removed.
- **`trim-history`** — keeps all system messages plus the most recent turns that
  fit within `HISTORY_TOKEN_BUDGET`; the latest message is always kept and
  dangling leading `tool` messages are dropped.
- **Response cache** — deterministic requests (`temperature: 0`, non-streaming)
  are keyed by a SHA-256 of the canonical request and served from an in-memory
  TTL + LRU cache, skipping the upstream call entirely.

## API

Base URL: `http://{HOST}:{PORT}` (default `http://127.0.0.1:8787`).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | Liveness probe. |
| `GET` | `/metrics` | proxy key* | Cumulative, content-free savings metrics. |
| `POST` | `/v1/chat/completions` | proxy key* | Minimises then forwards a chat completion. |
| `ANY` | `/v1/*` | proxy key* | Transparent pass-through for all other OpenAI-compatible routes. |

\* Auth is only enforced when `PROXY_API_KEY` is set. `/healthz` is always open.

### Response headers on `/v1/chat/completions`

| Header | Description |
| --- | --- |
| `x-token-minimiser-tokens-before` | Estimated prompt tokens before minimisation. |
| `x-token-minimiser-tokens-after` | Estimated prompt tokens after minimisation. |
| `x-token-minimiser-strategies` | Comma-separated strategies applied (`none` if all no-ops). |
| `x-token-minimiser-cache` | `HIT` when served from cache (header absent otherwise). |

### Error responses

Errors use the OpenAI error envelope: `{ "error": { "message", "type" } }`.

| Status | When | Body `type` |
| --- | --- | --- |
| `400` | Missing/invalid `messages[]`. | – |
| `401` | `PROXY_API_KEY` set and the caller's Bearer token doesn't match. | `auth_error` |
| `502` | The upstream provider could not be reached. | `upstream_error` |

Upstream errors (e.g. a `401` for a bad OpenAI key, `429` rate limit) are passed
through with the upstream's original status and body.

## Connecting clients

### OpenAI SDKs / any OpenAI-compatible tool

Set the base URL to the proxy and use your normal API key:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="sk-..."   # or rely on UPSTREAM_API_KEY in the proxy's .env
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8787/v1")
client.chat.completions.create(model="gpt-4o-mini",
                               messages=[{"role": "user", "content": "Hi"}])
```

### GitHub Models / Copilot

Set `UPSTREAM=github-models` (base URL `https://models.github.ai/inference`) and
`UPSTREAM_API_KEY` to a GitHub token with the `models` scope, then point your
client at `http://127.0.0.1:8787`. Any tool that lets you override the OpenAI
base URL (editor extensions, gateways, SDKs) can route through the proxy.

## OpenAPI & Postman

- **OpenAPI 3.1 spec:** [`openapi.yaml`](openapi.yaml) — documents every endpoint
  with request schemas and **both success and error responses** with examples.
- **Postman collection:** [`postman_collection.json`](postman_collection.json) —
  importable requests with saved example responses for success **and** error
  cases (400 / 401 / 502). Uses collection variables `baseUrl`, `apiKey` and
  `proxyKey` (Postman → *Import* → select the file, then edit variables).

## Security & privacy

- **Nothing personal is committed.** `.env`, `*.key`, `*.pem`, `secrets/` and
  local configs are git-ignored. `.env.example` contains placeholders only.
- **Run locally.** Default bind is `127.0.0.1`. Only expose it deliberately, and
  set `PROXY_API_KEY` if you do.
- **No persistence.** Prompts/responses are never logged at `info` level and are
  never written to disk. The response cache is in-memory and process-scoped.
- **Metrics are aggregate only** — counts and token totals, never content.
- **Key handling.** The upstream key is read from the environment and used only
  to set the `Authorization` header on the outbound request.

## Development

```bash
npm run dev        # run with live reload (tsx)
npm test           # run the vitest suite
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # compile to dist/
```

Layout:

```
src/
  index.ts              # entry point / bootstrap
  server.ts             # Express app, routing, headers, caching
  config.ts             # env → typed config + presets
  tokenizer.ts          # token estimation (gpt-tokenizer)
  cache.ts              # TTL + LRU response cache
  metrics.ts            # cumulative savings metrics
  logger.ts             # level-based logger
  providers/upstream.ts # upstream forwarder (undici)
  minimisers/           # strip-whitespace, dedupe, history, pipeline
test/                   # vitest unit + integration tests
openapi.yaml            # OpenAPI 3.1 spec
postman_collection.json # Postman collection with example responses
```

## License

[MIT](LICENSE)
