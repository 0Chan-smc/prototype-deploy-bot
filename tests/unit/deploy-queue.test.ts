import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeployQueue, NonRetryableError, type Job } from '../../src/queue/deploy-queue.js';

function makeParams(eventId = 'evt-1') {
  return { eventId, fileId: 'file-1', channelId: 'ch-1', userId: 'user-1' };
}

describe('DeployQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Enqueue a job -> processor called -> status: pending -> processing -> done
  it('enqueue a job transitions status pending -> processing -> done', async () => {
    const statuses: string[] = [];

    const processor = vi.fn(async (job: Job) => {
      statuses.push(job.status); // should be 'processing' when called
    });

    const queue = new DeployQueue(processor);
    const result = queue.enqueue(makeParams());

    expect(result).toBe(true);

    // Wait for processing to finish
    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledOnce();
    });

    // Processor saw 'processing' status
    expect(statuses).toEqual(['processing']);

    // After completion the job should be 'done'
    await vi.waitFor(() => {
      expect(queue.getJob('evt-1')?.status).toBe('done');
    });
  });

  // 2. Enqueue duplicate eventId -> second call returns false, processor runs once
  it('enqueue duplicate eventId is ignored', async () => {
    const processor = vi.fn(async (_job: Job) => {});

    const queue = new DeployQueue(processor);
    expect(queue.enqueue(makeParams('dup'))).toBe(true);
    expect(queue.enqueue(makeParams('dup'))).toBe(false);

    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledOnce();
    });
  });

  // 3. Two jobs enqueued concurrently run serially
  it('processes jobs serially', async () => {
    let concurrency = 0;
    let maxConcurrency = 0;
    const order: string[] = [];

    const processor = vi.fn(async (job: Job) => {
      concurrency++;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      order.push(job.eventId);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 50));
      concurrency--;
    });

    const queue = new DeployQueue(processor);
    queue.enqueue(makeParams('a'));
    queue.enqueue(makeParams('b'));

    await vi.waitFor(
      () => {
        expect(processor).toHaveBeenCalledTimes(2);
      },
      { timeout: 500 },
    );

    // Wait for second job to finish
    await vi.waitFor(
      () => {
        expect(queue.getJob('b')?.status).toBe('done');
      },
      { timeout: 500 },
    );

    expect(maxConcurrency).toBe(1);
    expect(order).toEqual(['a', 'b']);
  });

  // 4. Processor throws Error -> retries up to 2 times, succeeds on retry -> done
  it('retries on normal error and succeeds', async () => {
    let attempts = 0;

    const processor = vi.fn(async (_job: Job) => {
      attempts++;
      if (attempts < 3) {
        throw new Error('transient');
      }
    });

    const queue = new DeployQueue(processor);
    queue.enqueue(makeParams());

    await vi.waitFor(
      () => {
        expect(queue.getJob('evt-1')?.status).toBe('done');
      },
      { timeout: 500 },
    );

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  // 5. Processor throws NonRetryableError -> no retry, immediate failed
  it('does not retry on NonRetryableError', async () => {
    const processor = vi.fn(async (_job: Job) => {
      throw new NonRetryableError('permanent');
    });

    const onJobFailed = vi.fn(async () => {});
    const queue = new DeployQueue(processor, onJobFailed);
    queue.enqueue(makeParams());

    await vi.waitFor(() => {
      expect(queue.getJob('evt-1')?.status).toBe('failed');
    });

    expect(processor).toHaveBeenCalledOnce();
    expect(onJobFailed).toHaveBeenCalledOnce();
  });

  // 6. Processor fails all 3 attempts -> failed, onJobFailed called
  it('marks job as failed after exhausting retries and calls onJobFailed', async () => {
    const processor = vi.fn(async (_job: Job) => {
      throw new Error('always fails');
    });

    const onJobFailed = vi.fn(async () => {});
    const queue = new DeployQueue(processor, onJobFailed);
    queue.enqueue(makeParams());

    await vi.waitFor(
      () => {
        expect(queue.getJob('evt-1')?.status).toBe('failed');
      },
      { timeout: 500 },
    );

    // 1 initial + 2 retries = 3 total
    expect(processor).toHaveBeenCalledTimes(3);
    expect(onJobFailed).toHaveBeenCalledOnce();
    expect(onJobFailed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', status: 'failed' }),
      expect.any(Error),
    );
  });

  // 7. Completed/failed jobs evicted after TTL
  it('evicts completed jobs after TTL', async () => {
    vi.useFakeTimers();

    const processor = vi.fn(async (_job: Job) => {});
    const queue = new DeployQueue(processor);
    queue.enqueue(makeParams());

    // Let microtasks settle so the processor runs (it's instant under fake timers)
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.has('evt-1')).toBe(true);

    // Advance just under the TTL - should still be present
    vi.advanceTimersByTime(3600_000 - 1);
    expect(queue.has('evt-1')).toBe(true);

    // Advance past the 1-hour TTL
    vi.advanceTimersByTime(2);

    expect(queue.has('evt-1')).toBe(false);
  });

  // 8. shutdown() stops accepting new jobs and resolves when current job finishes
  it('shutdown stops accepting and resolves when current job finishes', async () => {
    let resolveProcessor!: () => void;
    const processorPromise = new Promise<void>((r) => {
      resolveProcessor = r;
    });

    const processor = vi.fn(async (_job: Job) => {
      await processorPromise;
    });

    const queue = new DeployQueue(processor);
    queue.enqueue(makeParams('s1'));

    // Wait for processor to start
    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledOnce();
    });

    const shutdownPromise = queue.shutdown();

    // New jobs should be rejected
    expect(queue.enqueue(makeParams('s2'))).toBe(false);

    // Shutdown hasn't resolved yet since processor is still running
    let resolved = false;
    shutdownPromise.then(() => {
      resolved = true;
    });

    // Give microtasks a tick
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Let the processor finish
    resolveProcessor();

    await shutdownPromise;
    expect(resolved).toBe(true);
  });
});
