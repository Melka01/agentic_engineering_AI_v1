/**
 * Production entry point: `node dist/server/index.js`.
 */
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const webDist = config.webDist ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  const app = await buildApp({
    services: (logger) => createServices(config, logger),
    logger: { level: config.logLevel },
    webDist,
  });
  app.log.info(
    { aiMode: config.aiMode, primaryModel: config.primaryModel, fallbackModel: config.fallbackModel, webDist },
    config.aiMode === 'offline'
      ? 'Starting in offline mode (deterministic agents). Set ANTHROPIC_API_KEY or RE_AI_MODE=anthropic to use Claude.'
      : 'Starting with Claude agents, provider fallback and deterministic fallback.',
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal start-up error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
