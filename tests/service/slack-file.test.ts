import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebClient } from '@slack/web-api';
import { getFile } from '../../src/services/slack-file.js';
import { NonRetryableError } from '../../src/queue/deploy-queue.js';

describe('getFile', () => {
  const token = 'xoxb-test-token';
  const fileId = 'F123ABC';
  let client: { files: { info: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    client = {
      files: {
        info: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns file info and content for an HTML file', async () => {
    const htmlContent = '<html><body>Hello</body></html>';
    const contentBuffer = Buffer.from(htmlContent);

    client.files.info.mockResolvedValue({
      ok: true,
      file: {
        name: 'index.html',
        mimetype: 'text/html',
        size: contentBuffer.length,
        url_private_download: 'https://files.slack.com/files-pri/T00/index.html',
      },
    });

    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(contentBuffer.buffer.slice(
        contentBuffer.byteOffset,
        contentBuffer.byteOffset + contentBuffer.byteLength,
      )),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const result = await getFile(client as unknown as WebClient, token, fileId);

    expect(result).toEqual({
      skipped: false,
      info: {
        filename: 'index.html',
        mimetype: 'text/html',
        size: contentBuffer.length,
      },
      content: contentBuffer,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://files.slack.com/files-pri/T00/index.html',
      { headers: { Authorization: `Bearer ${token}` } },
    );
  });

  it('returns skipped for non-HTML file', async () => {
    client.files.info.mockResolvedValue({
      ok: true,
      file: {
        name: 'photo.png',
        mimetype: 'image/png',
        size: 1024,
        url_private_download: 'https://files.slack.com/files-pri/T00/photo.png',
      },
    });

    const result = await getFile(client as unknown as WebClient, token, fileId);

    expect(result).toEqual({
      skipped: true,
      reason: 'Not an HTML file: photo.png (image/png)',
    });
  });

  it('throws NonRetryableError when no download URL', async () => {
    client.files.info.mockResolvedValue({
      ok: true,
      file: {
        name: 'index.html',
        mimetype: 'text/html',
        size: 100,
        // no url_private_download
      },
    });

    await expect(getFile(client as unknown as WebClient, token, fileId))
      .rejects.toThrow(NonRetryableError);
    await expect(getFile(client as unknown as WebClient, token, fileId))
      .rejects.toThrow('No download URL available for file: index.html');
  });

  it('propagates error when files.info API call fails', async () => {
    const apiError = new Error('slack_api_error');
    client.files.info.mockRejectedValue(apiError);

    await expect(getFile(client as unknown as WebClient, token, fileId))
      .rejects.toThrow('slack_api_error');
  });

  it('propagates network error when fetch fails (retryable)', async () => {
    client.files.info.mockResolvedValue({
      ok: true,
      file: {
        name: 'index.html',
        mimetype: 'text/html',
        size: 100,
        url_private_download: 'https://files.slack.com/files-pri/T00/index.html',
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(getFile(client as unknown as WebClient, token, fileId))
      .rejects.toThrow('Failed to fetch');
  });

  it('treats .html extension with non-HTML mimetype as HTML', async () => {
    const htmlContent = '<html><body>Test</body></html>';
    const contentBuffer = Buffer.from(htmlContent);

    client.files.info.mockResolvedValue({
      ok: true,
      file: {
        name: 'page.html',
        mimetype: 'application/octet-stream',
        size: contentBuffer.length,
        url_private_download: 'https://files.slack.com/files-pri/T00/page.html',
      },
    });

    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(contentBuffer.buffer.slice(
        contentBuffer.byteOffset,
        contentBuffer.byteOffset + contentBuffer.byteLength,
      )),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const result = await getFile(client as unknown as WebClient, token, fileId);

    expect(result).toEqual({
      skipped: false,
      info: {
        filename: 'page.html',
        mimetype: 'application/octet-stream',
        size: contentBuffer.length,
      },
      content: contentBuffer,
    });
  });
});
