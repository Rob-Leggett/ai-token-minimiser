import type { Preset } from './types.js';

export type LogLevel = 'silent' | 'error' | 'info' | 'debug';

export interface Config {
  port: number;
  host: string;
  upstream: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  proxyApiKey: string;
  preset: Preset;
  historyTokenBudget: number;
  stripWhitespace: boolean;
  dedupeMessages: boolean;
  responseCache: boolean;
  responseCacheTtlSeconds: number;
  responseCacheMaxEntries: number;
  logLevel: LogLevel;
}

const KNOWN_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  'github-models': 'https://models.github.ai/inference',
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build configuration from a set of environment variables.
 * Presets seed sensible defaults; explicit env vars always win.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const preset = (env.MINIMISE_PRESET as Preset) || 'balanced';
  const presetDefaults = presetToDefaults(preset);

  const upstream = env.UPSTREAM || 'openai';
  const upstreamBaseUrl =
    env.UPSTREAM_BASE_URL || KNOWN_BASE_URLS[upstream] || KNOWN_BASE_URLS.openai;

  return {
    port: int(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    upstream,
    upstreamBaseUrl: upstreamBaseUrl.replace(/\/+$/, ''),
    upstreamApiKey: env.UPSTREAM_API_KEY || '',
    proxyApiKey: env.PROXY_API_KEY || '',
    preset,
    historyTokenBudget: int(env.HISTORY_TOKEN_BUDGET, presetDefaults.historyTokenBudget),
    stripWhitespace: bool(env.STRIP_WHITESPACE, presetDefaults.stripWhitespace),
    dedupeMessages: bool(env.DEDUPE_MESSAGES, presetDefaults.dedupeMessages),
    responseCache: bool(env.RESPONSE_CACHE, presetDefaults.responseCache),
    responseCacheTtlSeconds: int(env.RESPONSE_CACHE_TTL_SECONDS, 3600),
    responseCacheMaxEntries: int(env.RESPONSE_CACHE_MAX_ENTRIES, 500),
    logLevel: (env.LOG_LEVEL as LogLevel) || 'info',
  };
}

interface PresetDefaults {
  historyTokenBudget: number;
  stripWhitespace: boolean;
  dedupeMessages: boolean;
  responseCache: boolean;
}

export function presetToDefaults(preset: Preset): PresetDefaults {
  switch (preset) {
    case 'off':
      return {
        historyTokenBudget: 0,
        stripWhitespace: false,
        dedupeMessages: false,
        responseCache: false,
      };
    case 'safe':
      return {
        historyTokenBudget: 0,
        stripWhitespace: true,
        dedupeMessages: true,
        responseCache: false,
      };
    case 'aggressive':
      return {
        historyTokenBudget: 3000,
        stripWhitespace: true,
        dedupeMessages: true,
        responseCache: true,
      };
    case 'balanced':
    default:
      return {
        historyTokenBudget: 6000,
        stripWhitespace: true,
        dedupeMessages: true,
        responseCache: true,
      };
  }
}
