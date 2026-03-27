export interface Job {
  eventId: string;
  fileId: string;
  channelId: string;
  userId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  retryCount: number;
  createdAt: number;
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export class DeployQueue {
  private jobs = new Map<string, Job>();
  private processing = false;
  private queue: Job[] = [];
  private accepting = true;
  private drainResolvers: Array<() => void> = [];

  constructor(
    private processor: (job: Job) => Promise<void>,
    private onJobFailed?: (job: Job, error: Error) => Promise<void>,
    private maxRetries = 2,
    private evictionTtlMs = 3600_000,
  ) {}

  enqueue(params: Omit<Job, 'status' | 'retryCount' | 'createdAt'>): boolean {
    if (!this.accepting) return false;
    if (this.jobs.has(params.eventId)) return false;

    const job: Job = {
      ...params,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
    };

    this.jobs.set(job.eventId, job);
    this.queue.push(job);
    this.drain();
    return true;
  }

  has(eventId: string): boolean {
    return this.jobs.has(eventId);
  }

  getJob(eventId: string): Job | undefined {
    return this.jobs.get(eventId);
  }

  shutdown(): Promise<void> {
    this.accepting = false;
    if (!this.processing) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.status = 'processing';

      try {
        await this.processor(job);
        job.status = 'done';
        this.scheduleEviction(job.eventId);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (error instanceof NonRetryableError || job.retryCount >= this.maxRetries) {
          job.status = 'failed';
          this.scheduleEviction(job.eventId);
          if (this.onJobFailed) {
            await this.onJobFailed(job, error);
          }
        } else {
          job.retryCount++;
          job.status = 'pending';
          this.queue.push(job);
        }
      }
    }

    this.processing = false;

    for (const resolve of this.drainResolvers) {
      resolve();
    }
    this.drainResolvers = [];
  }

  private scheduleEviction(eventId: string): void {
    setTimeout(() => {
      this.jobs.delete(eventId);
    }, this.evictionTtlMs);
  }
}
