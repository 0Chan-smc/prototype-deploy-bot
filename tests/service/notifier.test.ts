import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebClient } from '@slack/web-api';
import { notifySuccess, notifyFailure } from '../../src/services/notifier.js';
import type { SuccessParams, FailureParams } from '../../src/services/notifier.js';

describe('notifySuccess', () => {
  let client: { chat: { postMessage: ReturnType<typeof vi.fn> } };

  const params: SuccessParams = {
    channel: 'C123',
    filename: 'index.html',
    userId: 'U456',
    projectName: 'my-project',
    deployUrl: 'https://my-project.pages.dev',
    durationMs: 3500,
  };

  beforeEach(() => {
    client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls chat.postMessage with correct channel and message content', async () => {
    await notifySuccess(client as unknown as WebClient, params);

    expect(client.chat.postMessage).toHaveBeenCalledOnce();
    const call = client.chat.postMessage.mock.calls[0][0];

    expect(call.channel).toBe('C123');
    expect(call.text).toContain('index.html');
    expect(call.text).toContain('<@U456>');
    expect(call.text).toContain('my-project');
    expect(call.text).toContain('https://my-project.pages.dev');
    expect(call.text).toContain('3.5s');
  });

  it('does not rethrow when chat.postMessage throws', async () => {
    const error = new Error('slack_api_error');
    client.chat.postMessage.mockRejectedValue(error);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifySuccess(client as unknown as WebClient, params)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to send success notification:',
      error,
    );
  });
});

describe('notifyFailure', () => {
  let client: { chat: { postMessage: ReturnType<typeof vi.fn> } };

  const params: FailureParams = {
    channel: 'C123',
    filename: 'index.html',
    stage: 'wrangler deploy',
    errorMessage: 'Project not found',
    retryCount: 2,
    maxRetries: 3,
  };

  beforeEach(() => {
    client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls chat.postMessage with correct channel and failure details', async () => {
    await notifyFailure(client as unknown as WebClient, params);

    expect(client.chat.postMessage).toHaveBeenCalledOnce();
    const call = client.chat.postMessage.mock.calls[0][0];

    expect(call.channel).toBe('C123');
    expect(call.text).toContain('index.html');
    expect(call.text).toContain('wrangler deploy');
    expect(call.text).toContain('Project not found');
    expect(call.text).toContain('2/3');
  });

  it('does not rethrow when chat.postMessage throws', async () => {
    const error = new Error('network_error');
    client.chat.postMessage.mockRejectedValue(error);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(notifyFailure(client as unknown as WebClient, params)).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to send failure notification:',
      error,
    );
  });
});
