import type { WebClient } from '@slack/web-api';

export interface SuccessParams {
  channel: string;
  filename: string;
  userId: string;
  projectName: string;
  deployUrl: string;
  durationMs: number;
}

export interface FailureParams {
  channel: string;
  filename: string;
  stage: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
}

export async function notifySuccess(client: WebClient, params: SuccessParams): Promise<void> {
  const durationSec = (params.durationMs / 1000).toFixed(1);
  const text = [
    '✅ 배포 완료',
    `• 파일: ${params.filename}`,
    `• 업로더: <@${params.userId}>`,
    `• 프로젝트: ${params.projectName}`,
    `• URL: ${params.deployUrl}`,
    `• 처리 시간: ${durationSec}s`,
  ].join('\n');

  try {
    await client.chat.postMessage({ channel: params.channel, text });
  } catch (err) {
    console.error('Failed to send success notification:', err);
  }
}

export async function notifyFailure(client: WebClient, params: FailureParams): Promise<void> {
  const text = [
    '❌ 배포 실패',
    `• 파일: ${params.filename}`,
    `• 실패 단계: ${params.stage}`,
    `• 원인: ${params.errorMessage}`,
    `• 재시도: ${params.retryCount}/${params.maxRetries}`,
  ].join('\n');

  try {
    await client.chat.postMessage({ channel: params.channel, text });
  } catch (err) {
    console.error('Failed to send failure notification:', err);
  }
}
