import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

type DeployConfig = Pick<Config, 'CLOUDFLARE_API_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_PROJECT_NAME'>;

export async function deploy(htmlContent: Buffer, config: DeployConfig): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-'));

  try {
    const distDir = path.join(tmpDir, 'dist');
    await fs.mkdir(distDir);
    await fs.writeFile(path.join(distDir, 'index.html'), htmlContent);

    // wrangler.toml을 tmpDir에 동적 생성 (Workers Static Assets 모델)
    const wranglerToml = [
      `name = "${config.CLOUDFLARE_PROJECT_NAME}"`,
      `compatibility_date = "2024-09-23"`,
      ``,
      `[assets]`,
      `directory = "./dist"`,
    ].join('\n');
    await fs.writeFile(path.join(tmpDir, 'wrangler.toml'), wranglerToml);

    let result;
    try {
      const wranglerBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'wrangler');
      result = await execa(wranglerBin, [
        'deploy',
      ], {
        cwd: tmpDir,
        env: {
          CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
        },
      });
    } catch (error: any) {
      const stderr = error.stderr ?? '';
      const stdout = error.stdout ?? '';
      console.error(`[DEBUG] Wrangler stderr: ${stderr}`);
      console.error(`[DEBUG] Wrangler stdout: ${stdout}`);
      throw new Error(`Wrangler deploy failed: ${stderr || stdout}`);
    }

    // Workers 배포 URL 파싱 (예: https://smc-lens.xxx.workers.dev 또는 커스텀 도메인)
    const urlMatch = result.stdout.match(/https:\/\/[\w-]+\.[\w.-]+\.(workers\.dev|pages\.dev)/);
    if (!urlMatch) {
      throw new Error(`Could not parse deploy URL from wrangler output: ${result.stdout}`);
    }

    return urlMatch[0];
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
