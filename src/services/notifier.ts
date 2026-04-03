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

  const text = `✅ 배포 완료 — ${params.filename} → ${params.deployUrl}`;

  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ 배포 완료', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${params.filename}* 이 성공적으로 배포되었습니다.` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 배포 사이트 열기', emoji: true },
          url: params.deployUrl,
          style: 'primary',
          action_id: 'open_deploy_url',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `📎 업로더: <@${params.userId}> · 프로젝트: ${params.projectName}` },
        { type: 'mrkdwn', text: `⏱️ 처리 시간: ${durationSec}s` },
      ],
    },
  ];

  try {
    await client.chat.postMessage({ channel: params.channel, text, blocks: blocks as any });
  } catch (err) {
    console.error('Failed to send success notification:', err);
  }
}

export async function notifyFailure(client: WebClient, params: FailureParams): Promise<void> {
  const text = `❌ 배포 실패 — ${params.filename} (${params.stage}: ${params.errorMessage})`;

  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '❌ 배포 실패', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${params.filename}* 배포에 실패했습니다.` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📋 실패 단계*\n${params.stage}` },
        { type: 'mrkdwn', text: `*💬 원인*\n${params.errorMessage}` },
      ],
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `🔄 재시도: ${params.retryCount}/${params.maxRetries}` },
      ],
    },
  ];

  try {
    await client.chat.postMessage({ channel: params.channel, text, blocks: blocks as any });
  } catch (err) {
    console.error('Failed to send failure notification:', err);
  }
}
