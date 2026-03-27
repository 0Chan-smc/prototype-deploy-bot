import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { deploy } from '../../src/services/deployer.js';

const mockedExeca = vi.mocked(execa);

const baseConfig = {
  CLOUDFLARE_API_TOKEN: 'test-api-token',
  CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
  CLOUDFLARE_PROJECT_NAME: 'my-site',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deploy', () => {
  it('should return deploy URL when wrangler exits with code 0', async () => {
    mockedExeca.mockResolvedValue({
      stdout: 'Deploying... https://my-site.example.workers.dev Done!',
      stderr: '',
      exitCode: 0,
    } as any);

    const result = await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    expect(result).toBe('https://my-site.example.workers.dev');
  });

  it('should also parse pages.dev URLs', async () => {
    mockedExeca.mockResolvedValue({
      stdout: 'Deploying... https://abc123.my-site.pages.dev Done!',
      stderr: '',
      exitCode: 0,
    } as any);

    const result = await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    expect(result).toBe('https://abc123.my-site.pages.dev');
  });

  it('should throw error when wrangler exits with non-zero code', async () => {
    mockedExeca.mockRejectedValue(
      Object.assign(new Error('Command failed'), {
        stdout: '',
        stderr: 'Authentication failed',
        exitCode: 1,
      }),
    );

    await expect(deploy(Buffer.from('<html>hello</html>'), baseConfig)).rejects.toThrow(
      'Authentication failed',
    );
  });

  it('should write dist/index.html with exact content of input buffer', async () => {
    let writtenContent = Buffer.alloc(0);

    mockedExeca.mockImplementation(async (_cmd, _args, options: any) => {
      const cwd = options?.cwd as string;
      writtenContent = await fs.readFile(path.join(cwd, 'dist', 'index.html'));
      return {
        stdout: 'https://my-site.example.workers.dev',
        stderr: '',
        exitCode: 0,
      } as any;
    });

    const htmlContent = Buffer.from('<html><body>test content</body></html>');
    await deploy(htmlContent, baseConfig);

    expect(writtenContent).toEqual(htmlContent);
  });

  it('should create wrangler.toml in temp directory', async () => {
    let tomlContent = '';

    mockedExeca.mockImplementation(async (_cmd, _args, options: any) => {
      const cwd = options?.cwd as string;
      tomlContent = await fs.readFile(path.join(cwd, 'wrangler.toml'), 'utf-8');
      return {
        stdout: 'https://my-site.example.workers.dev',
        stderr: '',
        exitCode: 0,
      } as any;
    });

    await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    expect(tomlContent).toContain('name = "my-site"');
    expect(tomlContent).toContain('[assets]');
    expect(tomlContent).toContain('directory = "./dist"');
  });

  it('should clean up temp directory on success', async () => {
    let capturedCwd = '';

    mockedExeca.mockImplementation(async (_cmd, _args, options: any) => {
      capturedCwd = options?.cwd as string;
      return {
        stdout: 'https://my-site.example.workers.dev',
        stderr: '',
        exitCode: 0,
      } as any;
    });

    await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    await expect(fs.access(capturedCwd)).rejects.toThrow();
  });

  it('should clean up temp directory on failure', async () => {
    let capturedCwd = '';

    mockedExeca.mockImplementation(async (_cmd, _args, options: any) => {
      capturedCwd = options?.cwd as string;
      throw Object.assign(new Error('Command failed'), {
        stdout: '',
        stderr: 'deploy error',
        exitCode: 1,
      });
    });

    await expect(deploy(Buffer.from('<html>hello</html>'), baseConfig)).rejects.toThrow();

    await expect(fs.access(capturedCwd)).rejects.toThrow();
  });

  it('should call wrangler deploy (not pages deploy) with cwd', async () => {
    mockedExeca.mockResolvedValue({
      stdout: 'https://my-site.example.workers.dev',
      stderr: '',
      exitCode: 0,
    } as any);

    await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    expect(mockedExeca).toHaveBeenCalledOnce();
    const [cmd, args, options] = mockedExeca.mock.calls[0];
    expect(cmd).toContain('wrangler');
    expect(args).toEqual(['deploy']);
    expect((options as any).cwd).toBeTruthy();
  });

  it('should pass CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as env vars', async () => {
    mockedExeca.mockResolvedValue({
      stdout: 'https://my-site.example.workers.dev',
      stderr: '',
      exitCode: 0,
    } as any);

    await deploy(Buffer.from('<html>hello</html>'), baseConfig);

    const options = mockedExeca.mock.calls[0][2] as any;
    expect(options.env).toEqual({
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
    });
  });
});
