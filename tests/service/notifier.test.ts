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

  it('sends Block Kit message with header, button, and context', async () => {
    await notifySuccess(client as unknown as WebClient, params);

    expect(client.chat.postMessage).toHaveBeenCalledOnce();
    const call = client.chat.postMessage.mock.calls[0][0];

    expect(call.channel).toBe('C123');

    // fallback text
    expect(call.text).toContain('배포 완료');
    expect(call.text).toContain('index.html');

    // blocks 존재
    expect(call.blocks).toBeDefined();
    expect(call.blocks).toHaveLength(4);

    // header block
    expect(call.blocks[0]).toMatchObject({
      type: 'header',
      text: { type: 'plain_text', text: '✅ 배포 완료' },
    });

    // section with filename
    expect(call.blocks[1].text.text).toContain('*index.html*');

    // actions block with primary button linking to deploy URL
    const button = call.blocks[2].elements[0];
    expect(button.type).toBe('button');
    expect(button.url).toBe('https://my-project.pages.dev');
    expect(button.style).toBe('primary');

    // context block with user mention, project name, duration
    const contextTexts = call.blocks[3].elements.map((e: any) => e.text);
    expect(contextTexts.some((t: string) => t.includes('<@U456>'))).toBe(true);
    expect(contextTexts.some((t: string) => t.includes('my-project'))).toBe(true);
    expect(contextTexts.some((t: string) => t.includes('3.5s'))).toBe(true);
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
    stage: 'deploy',
    errorMessage: 'Wrangler deploy failed',
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

  it('sends Block Kit message with header, fields, and context', async () => {
    await notifyFailure(client as unknown as WebClient, params);

    expect(client.chat.postMessage).toHaveBeenCalledOnce();
    const call = client.chat.postMessage.mock.calls[0][0];

    expect(call.channel).toBe('C123');

    // fallback text
    expect(call.text).toContain('배포 실패');
    expect(call.text).toContain('index.html');

    // blocks
    expect(call.blocks).toBeDefined();
    expect(call.blocks).toHaveLength(4);

    // header
    expect(call.blocks[0]).toMatchObject({
      type: 'header',
      text: { type: 'plain_text', text: '❌ 배포 실패' },
    });

    // section with filename
    expect(call.blocks[1].text.text).toContain('*index.html*');

    // fields section with stage and error message
    const fields = call.blocks[2].fields;
    expect(fields).toHaveLength(2);
    expect(fields[0].text).toContain('deploy');
    expect(fields[1].text).toContain('Wrangler deploy failed');

    // context with retry count
    expect(call.blocks[3].elements[0].text).toContain('2/3');
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
