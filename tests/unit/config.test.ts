import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

const REQUIRED_ENV = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_SIGNING_SECRET: 'test-signing-secret',
  SLACK_APP_TOKEN: 'xapp-test-token',
  SLACK_SOCKET_MODE: 'false',
  TARGET_CHANNEL_ID: 'C1234567890',
  NOTIFY_CHANNEL_ID: 'C0987654321',
  CLOUDFLARE_API_TOKEN: 'cf-api-token',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account-id',
  CLOUDFLARE_PROJECT_NAME: 'my-project',
};

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all relevant keys before each test
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
    delete process.env.ALLOWED_USER_IDS;
    delete process.env.MAX_FILE_SIZE_BYTES;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns correct Config when all required env vars are present', () => {
    Object.assign(process.env, REQUIRED_ENV);

    const config = loadConfig();

    expect(config).toEqual({
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
      SLACK_APP_TOKEN: 'xapp-test-token',
      SLACK_SOCKET_MODE: false,
      TARGET_CHANNEL_ID: 'C1234567890',
      NOTIFY_CHANNEL_ID: 'C0987654321',
      CLOUDFLARE_API_TOKEN: 'cf-api-token',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account-id',
      CLOUDFLARE_PROJECT_NAME: 'my-project',
      ALLOWED_USER_IDS: [],
      MAX_FILE_SIZE_BYTES: 5242880,
      PORT: 3000,
    });
  });

  it('throws when SLACK_BOT_TOKEN is missing', () => {
    const { SLACK_BOT_TOKEN: _, ...rest } = REQUIRED_ENV;
    Object.assign(process.env, rest);

    expect(() => loadConfig()).toThrow('SLACK_BOT_TOKEN');
  });

  it('throws when SLACK_SOCKET_MODE=false and SLACK_SIGNING_SECRET is missing', () => {
    const { SLACK_SIGNING_SECRET: _, ...rest } = REQUIRED_ENV;
    Object.assign(process.env, { ...rest, SLACK_SOCKET_MODE: 'false' });

    expect(() => loadConfig()).toThrow('SLACK_SIGNING_SECRET');
  });

  it('succeeds when SLACK_SOCKET_MODE=true and SLACK_SIGNING_SECRET is missing', () => {
    const { SLACK_SIGNING_SECRET: _, ...rest } = REQUIRED_ENV;
    Object.assign(process.env, { ...rest, SLACK_SOCKET_MODE: 'true' });

    const config = loadConfig();

    expect(config.SLACK_SIGNING_SECRET).toBeUndefined();
    expect(config.SLACK_SOCKET_MODE).toBe(true);
  });

  it('defaults MAX_FILE_SIZE_BYTES to 5242880 and PORT to 3000 when not set', () => {
    Object.assign(process.env, REQUIRED_ENV);

    const config = loadConfig();

    expect(config.MAX_FILE_SIZE_BYTES).toBe(5242880);
    expect(config.PORT).toBe(3000);
  });

  it('parses SLACK_SOCKET_MODE="true" as boolean true', () => {
    Object.assign(process.env, { ...REQUIRED_ENV, SLACK_SOCKET_MODE: 'true' });

    const config = loadConfig();

    expect(config.SLACK_SOCKET_MODE).toBe(true);
  });

  it('parses SLACK_SOCKET_MODE="false" as boolean false', () => {
    Object.assign(process.env, { ...REQUIRED_ENV, SLACK_SOCKET_MODE: 'false' });

    const config = loadConfig();

    expect(config.SLACK_SOCKET_MODE).toBe(false);
  });

  it('parses ALLOWED_USER_IDS as comma-separated array', () => {
    Object.assign(process.env, { ...REQUIRED_ENV, ALLOWED_USER_IDS: 'U111,U222, U333' });

    const config = loadConfig();

    expect(config.ALLOWED_USER_IDS).toEqual(['U111', 'U222', 'U333']);
  });

  it('defaults ALLOWED_USER_IDS to empty array when not set', () => {
    Object.assign(process.env, REQUIRED_ENV);

    const config = loadConfig();

    expect(config.ALLOWED_USER_IDS).toEqual([]);
  });
});
