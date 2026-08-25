import { request as undiciRequest } from 'undici';
import type { Config } from '../config.js';

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: NodeJS.ReadableStream;
}

/**
 * Forward a request to the configured upstream provider. The proxy is a thin,
 * OpenAI-compatible pass-through: it only rewrites the target URL and the
 * Authorization header (when an upstream key is configured), leaving the body
 * and remaining headers intact.
 */
export async function forwardToUpstream(
  config: Config,
  path: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<UpstreamResponse> {
  const url = `${config.upstreamBaseUrl}${path}`;

  const outHeaders: Record<string, string> = { ...headers };
  // Never forward hop-by-hop / host headers.
  delete outHeaders.host;
  delete outHeaders['content-length'];
  delete outHeaders.connection;

  if (config.upstreamApiKey) {
    outHeaders.authorization = `Bearer ${config.upstreamApiKey}`;
  }

  const res = await undiciRequest(url, {
    method: method as never,
    headers: outHeaders,
    body,
  });

  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
  };
}
