import type { App } from '@slack/bolt';
import type { Config } from '../config.js';
import { DeployQueue, NonRetryableError } from '../queue/deploy-queue.js';
import type { Job } from '../queue/deploy-queue.js';
import { getFile } from '../services/slack-file.js';
import { validateHtml } from '../services/html-validator.js';
import { deploy } from '../services/deployer.js';
import { notifySuccess, notifyFailure } from '../services/notifier.js';

export function createProcessor(app: App, config: Config) {
  return async (job: Job): Promise<void> => {
    console.log(`[DEBUG] Processor started for job: ${job.eventId}, fileId: ${job.fileId}`);
    const startTime = Date.now();

    console.log(`[DEBUG] Calling getFile...`);
    const result = await getFile(app.client, config.SLACK_BOT_TOKEN, job.fileId);
    if (result.skipped) {
      console.log(`Skipped file ${job.fileId}: ${result.reason}`);
      return;
    }
    console.log(`[DEBUG] getFile success: ${result.info.filename}, ${result.info.size} bytes`);

    const validation = validateHtml(result.content, config.MAX_FILE_SIZE_BYTES);
    if (!validation.valid) {
      console.log(`[DEBUG] Validation failed: ${validation.errors.join(', ')}`);
      throw new NonRetryableError(
        `HTML validation failed: ${validation.errors.join(', ')}`,
      );
    }
    console.log(`[DEBUG] Validation passed, deploying...`);

    const deployUrl = await deploy(result.content, config);
    console.log(`[DEBUG] Deploy success: ${deployUrl}`);
    const durationMs = Date.now() - startTime;

    await notifySuccess(app.client, {
      channel: config.NOTIFY_CHANNEL_ID,
      filename: result.info.filename,
      userId: job.userId,
      projectName: config.CLOUDFLARE_PROJECT_NAME,
      deployUrl,
      durationMs,
    });
    console.log(`[DEBUG] Notification sent`);
  };
}

export function createOnJobFailed(app: App, config: Config) {
  return async (job: Job, error: Error): Promise<void> => {
    console.error(`[DEBUG] Job failed: ${job.eventId}, error: ${error.message}`);
    await notifyFailure(app.client, {
      channel: config.NOTIFY_CHANNEL_ID,
      filename: job.fileId,
      stage: error instanceof NonRetryableError ? 'validation' : 'deploy',
      errorMessage: error.message,
      retryCount: job.retryCount,
      maxRetries: 2,
    });
  };
}

export function registerFileSharedHandler(
  app: App,
  queue: DeployQueue,
  config: Config,
): void {
  app.event('file_shared', async ({ event, body }) => {
    console.log(`[DEBUG] file_shared handler fired: file_id=${event.file_id}, channel_id=${event.channel_id}, user_id=${event.user_id}`);

    if (event.channel_id !== config.TARGET_CHANNEL_ID) {
      console.log(`[DEBUG] Channel mismatch: got=${event.channel_id}, expected=${config.TARGET_CHANNEL_ID}`);
      return;
    }

    if (config.ALLOWED_USER_IDS.length > 0 && !config.ALLOWED_USER_IDS.includes(event.user_id)) {
      console.log(`[DEBUG] User not allowed: ${event.user_id}`);
      return;
    }

    const eventId = (body as Record<string, unknown>).event_id as string;
    if (queue.has(eventId)) {
      console.log(`[DEBUG] Duplicate event: ${eventId}`);
      return;
    }

    console.log(`[DEBUG] Enqueueing job: eventId=${eventId}, fileId=${event.file_id}`);
    queue.enqueue({
      eventId,
      fileId: event.file_id,
      channelId: event.channel_id,
      userId: event.user_id,
    });
  });
}
