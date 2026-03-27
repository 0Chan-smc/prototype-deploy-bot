import { App } from '@slack/bolt';
import { loadConfig } from './config.js';
import { DeployQueue } from './queue/deploy-queue.js';
import {
  createProcessor,
  createOnJobFailed,
  registerFileSharedHandler,
} from './handlers/file-shared.js';

async function main() {
  const config = loadConfig();

  const app = config.SLACK_SOCKET_MODE
    ? new App({
        token: config.SLACK_BOT_TOKEN,
        appToken: config.SLACK_APP_TOKEN,
        socketMode: true,
      })
    : new App({
        token: config.SLACK_BOT_TOKEN,
        signingSecret: config.SLACK_SIGNING_SECRET!,
      });

  const processor = createProcessor(app, config);
  const onJobFailed = createOnJobFailed(app, config);
  const queue = new DeployQueue(processor, onJobFailed);

  // Debug: log ALL incoming events
  app.use(async ({ body, next }) => {
    console.log(`[DEBUG] Event received: type=${(body as any).event?.type}, channel=${(body as any).event?.channel_id}`);
    console.log(`[DEBUG] Full body.event:`, JSON.stringify((body as any).event, null, 2));
    await next();
  });

  registerFileSharedHandler(app, queue, config);

  const mode = config.SLACK_SOCKET_MODE ? 'Socket Mode' : `HTTP Mode (port ${config.PORT})`;
  await app.start(config.PORT);
  console.log(`⚡ Deploy bot started in ${mode}`);
  console.log(`[DEBUG] TARGET_CHANNEL_ID=${config.TARGET_CHANNEL_ID}`);

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    queue.stopAccepting();
    await queue.shutdown();
    await app.stop();
    console.log('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
