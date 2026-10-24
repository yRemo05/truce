import type {
  ApiError as ApiErrorBody,
  CheckinInput,
  CheckinResult,
  DemoInput,
  DemoStarted,
  PairInput,
  PairView,
  ReceiptsView,
  SearchResult,
  Side,
  SideInput,
  SideSaved,
  Slot,
  StreamEvent,
  SwapInput,
  SwapsView,
  TonightInput,
  TruceView,
  VoteInput,
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
  onOpen(): void;
  /** `index` is the event's place in the truce's log (its SSE id). */
  onEvent(event: StreamEvent, index: number): void;
  /** The connection dropped; `willRetry` is false when the caller must reconnect itself. */
  onDrop(willRetry: boolean): void;
}

export interface Api {
  readonly kind: 'server' | 'mock';
  /** `near` keeps restaurant hits near that place; other slots ignore it. */
  search(slot: Slot, q: string, near: string | null, signal?: AbortSignal): Promise<SearchResult>;
  createPair(input: PairInput): Promise<{ id: string }>;
  getPair(id: string): Promise<PairView>;
  setLocation(pairId: string, location: string): Promise<PairView>;
  saveSide(pairId: string, side: Side, input: SideInput): Promise<SideSaved>;
  /** A new evening's answers (what matters most, foods, the brief); the saved favourites stay. */
  saveTonight(pairId: string, side: Side, input: TonightInput): Promise<SideSaved>;
  startTruce(pairId: string): Promise<{ truceId: string }>;
  /** A ready-made group: an instant replay of a recorded run with `replay`, else live (the server may still replay when busy). */
  demo(kind: DemoInput['kind'], replay?: boolean): Promise<DemoStarted>;
  getTruce(id: string): Promise<TruceView>;
  /** Every Qloo call the truce made, and one of them opened up. */
  receipts(truceId: string): Promise<ReceiptsView>;
  checkin(truceId: string, side: Side, input: CheckinInput): Promise<CheckinResult>;
  /** Where to download the evening as a calendar event. */
  calendarUrl(truceId: string): Promise<string>;
  /** The evening as it stands after any swaps, and every request made on it. */
  getSwaps(truceId: string): Promise<SwapsView>;
  /** Ask to swap one item, or to plan the evening again. */
  askSwap(truceId: string, input: SwapInput): Promise<SwapsView>;
  vote(truceId: string, swapId: string, side: Side, vote: VoteInput['vote']): Promise<SwapsView>;
  /** The asker withdraws an open request. */
  cancelSwap(truceId: string, swapId: string, side: Side): Promise<SwapsView>;
  /** Opens the live event stream from event `from` on; returns a function that closes it. */
  stream(truceId: string, from: number, handlers: StreamHandlers): () => void;
}
