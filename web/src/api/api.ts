import type {
  ApiError as ApiErrorBody,
  PairInput,
  PairView,
  SearchHit,
  Side,
  SideInput,
  Slot,
  StreamEvent,
  TruceView,
} from '@contract';

/** One failed request, as the UI needs it: what to say, and whether waiting helps. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  static fromBody(status: number, body: unknown): ApiError {
    const error = (body as Partial<ApiErrorBody> | null)?.error;
    if (error && typeof error.message === 'string') {
      return new ApiError(status, error.code ?? 'unknown', error.message, error.retryAfterSeconds ?? null);
    }
    return new ApiError(status, 'unknown', 'Truce had a problem answering. Try again in a moment.');
  }

  /** Any failure as an ApiError: unknown throws read as a lost connection. */
  static from(err: unknown): ApiError {
    return err instanceof ApiError ? err : ApiError.network();
  }

  static network(): ApiError {
    return new ApiError(0, 'network', "Can't reach Truce. Check your connection and try again.");
  }
}

export interface StreamHandlers {
  /** Every (re)connection replays the truce from its first event. */
  onOpen(): void;
  onEvent(event: StreamEvent): void;
  /** The connection dropped; `willRetry` is false when the caller must reconnect itself. */
  onDrop(willRetry: boolean): void;
}

export interface Api {
  readonly kind: 'server' | 'mock';
  search(slot: Slot, q: string, signal?: AbortSignal): Promise<SearchHit[]>;
  createPair(input: PairInput): Promise<{ id: string }>;
  getPair(id: string): Promise<PairView>;
  saveSide(pairId: string, side: Side, input: SideInput): Promise<{ ready: Record<Side, boolean> }>;
  startTruce(pairId: string): Promise<{ truceId: string }>;
  demo(): Promise<{ pairId: string; truceId: string }>;
  getTruce(id: string): Promise<TruceView>;
  /** Opens the live event stream; returns a function that closes it. */
  stream(truceId: string, handlers: StreamHandlers): () => void;
}
