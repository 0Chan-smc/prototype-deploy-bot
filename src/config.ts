export interface Config {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string | undefined;
  SLACK_APP_TOKEN: string;
  SLACK_SOCKET_MODE: boolean;
  TARGET_CHANNEL_ID: string;
  NOTIFY_CHANNEL_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_PROJECT_NAME: string;
  MAX_FILE_SIZE_BYTES: number;
  PORT: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  const SLACK_BOT_TOKEN = requireEnv('SLACK_BOT_TOKEN');
  const SLACK_APP_TOKEN = requireEnv('SLACK_APP_TOKEN');
  const SLACK_SOCKET_MODE = process.env.SLACK_SOCKET_MODE === 'true';

  let SLACK_SIGNING_SECRET: string | undefined;
  if (!SLACK_SOCKET_MODE) {
    SLACK_SIGNING_SECRET = requireEnv('SLACK_SIGNING_SECRET');
  } else {
    SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  }

  const TARGET_CHANNEL_ID = requireEnv('TARGET_CHANNEL_ID');
  const NOTIFY_CHANNEL_ID = requireEnv('NOTIFY_CHANNEL_ID');
  const CLOUDFLARE_API_TOKEN = requireEnv('CLOUDFLARE_API_TOKEN');
  const CLOUDFLARE_ACCOUNT_ID = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const CLOUDFLARE_PROJECT_NAME = requireEnv('CLOUDFLARE_PROJECT_NAME');

  const MAX_FILE_SIZE_BYTES = process.env.MAX_FILE_SIZE_BYTES
    ? Number(process.env.MAX_FILE_SIZE_BYTES)
    : 5242880;

  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  return {
    SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET,
    SLACK_APP_TOKEN,
    SLACK_SOCKET_MODE,
    TARGET_CHANNEL_ID,
    NOTIFY_CHANNEL_ID,
    CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_PROJECT_NAME,
    MAX_FILE_SIZE_BYTES,
    PORT,
  };
}
