#!/usr/bin/env node
import 'dotenv/config';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './server.js';

function main(): void {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.upstreamApiKey) {
    logger.info(
      'No UPSTREAM_API_KEY set — callers must pass their own Authorization header (pass-through mode).',
    );
  }

  const { app } = createApp({ config, logger });

  const server = app.listen(config.port, config.host, () => {
    logger.info(
      `ai-token-minimiser listening on http://${config.host}:${config.port} ` +
        `→ upstream ${config.upstream} (${config.upstreamBaseUrl}) [preset: ${config.preset}]`,
    );
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down.`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
