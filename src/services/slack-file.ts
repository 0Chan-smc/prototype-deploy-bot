import type { WebClient } from '@slack/web-api';
import { NonRetryableError } from '../queue/deploy-queue.js';

export interface FileInfo {
  filename: string;
  mimetype: string;
  size: number;
}

export type FileResult =
  | { skipped: false; info: FileInfo; content: Buffer }
  | { skipped: true; reason: string };

export async function getFile(
  client: WebClient,
  token: string,
  fileId: string,
): Promise<FileResult> {
  const result = await client.files.info({ file: fileId });
  const file = result.file!;

  const isHtml =
    file.mimetype === 'text/html' || (file.name?.endsWith('.html') ?? false);
  if (!isHtml) {
    return {
      skipped: true,
      reason: `Not an HTML file: ${file.name} (${file.mimetype})`,
    };
  }

  const downloadUrl = file.url_private_download;
  if (!downloadUrl) {
    throw new NonRetryableError(
      `No download URL available for file: ${file.name}`,
    );
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const content = Buffer.from(arrayBuffer);

  return {
    skipped: false,
    info: {
      filename: file.name ?? 'unknown.html',
      mimetype: file.mimetype ?? 'text/html',
      size: file.size ?? content.length,
    },
    content,
  };
}
