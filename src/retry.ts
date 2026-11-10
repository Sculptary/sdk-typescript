export interface RetryOptions {
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
const retryMethods = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

export class RetryPolicy {
  readonly maxRetries: number;
  readonly base: number;
  readonly max: number;

  constructor(options: RetryOptions) {
    this.maxRetries = options.maxRetries ?? 2;
    this.base = options.retryBaseDelayMs ?? 500;
    this.max = options.retryMaxDelayMs ?? 30_000;
    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0) throw new RangeError("maxRetries must be a non-negative integer.");
    for (const delay of [this.base, this.max]) {
      if (!Number.isFinite(delay) || delay < 0 || delay > 2_147_483_647) throw new RangeError("Retry delays must be finite numbers from 0 to 2147483647 milliseconds.");
    }
  }

  permits(method: string, attempt: number, replayable: boolean): boolean {
    return replayable && retryMethods.has(method) && attempt < this.maxRetries;
  }

  delay(attempt: number, response?: Response): number | undefined {
    const hint = response?.headers.get("Retry-After")?.trim();
    if (hint) {
      const numeric = Number(hint);
      const delay = Number.isNaN(numeric) ? Math.max(0, Date.parse(hint) - Date.now()) : numeric * 1000;
      if (Number.isFinite(delay) && delay >= 0) return delay <= this.max ? delay : undefined;
    }
    return Math.random() * (this.base === 0 ? 0 : Math.min(this.max, this.base * 2 ** attempt));
  }
}

export function snapshot(body?: BodyInit): { body?: BodyInit; replayable: boolean } {
  if (body == null || typeof body === "string" || body instanceof Blob) return { body, replayable: true };
  if (body instanceof ArrayBuffer) return { body: body.slice(0), replayable: true };
  if (ArrayBuffer.isView(body)) return { body: new Uint8Array(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)), replayable: true };
  if (body instanceof URLSearchParams) return { body: new URLSearchParams(body), replayable: true };
  return { body, replayable: false };
}

export function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal!.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
