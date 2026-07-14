import type { BasePlatformAdapter } from "./platforms/base.js";
import type { StreamingConfig } from "./config.js";

const DONE = Symbol("done");
const SEGMENT_BREAK = Symbol("segment");

type QueueItem = string | typeof DONE | typeof SEGMENT_BREAK;

const MAX_FLOOD_STRIKES = 3;
const MIN_NEW_MSG_CHARS = 4;

export class StreamConsumer {
  private _queue: QueueItem[] = [];
  private _accumulated = "";
  private _messageId?: string;
  private _messageCreatedAt = 0;
  private _alreadySent = false;
  private _editSupported = true;
  private _lastEditTime = 0;
  private _lastSentText = "";
  private _floodStrikes = 0;
  private _editInterval: number;
  private _finalResponseSent = false;

  constructor(
    private readonly _adapter: BasePlatformAdapter,
    private readonly _chatId: string,
    private readonly _threadId: string | undefined,
    config: StreamingConfig,
  ) {
    this._editInterval = config.editInterval;
  }

  get finalResponseSent(): boolean {
    return this._finalResponseSent;
  }

  onDelta(text: string): void {
    this._queue.push(text);
  }

  onSegmentBreak(): void {
    this._queue.push(SEGMENT_BREAK);
  }

  finish(): void {
    this._queue.push(DONE);
  }

  async run(): Promise<void> {
    while (true) {
      let gotDone = false;
      let gotSegment = false;

      while (this._queue.length > 0) {
        const item = this._queue.shift()!;
        if (item === DONE) gotDone = true;
        else if (item === SEGMENT_BREAK) gotSegment = true;
        else this._accumulated += item;
      }

      const now = Date.now();
      const elapsed = (now - this._lastEditTime) / 1000;
      const shouldEdit =
        gotDone ||
        gotSegment ||
        (!this._editSupported === false &&
          elapsed >= this._editInterval &&
          this._accumulated.length > 0);

      if (shouldEdit && this._accumulated.length > 0) {
        const text = this._cleanDisplay(this._accumulated);
        await this._sendOrEdit(text, gotDone);
        this._lastEditTime = now;
      }

      if (gotSegment) {
        this._accumulated = "";
        this._lastSentText = "";
        this._alreadySent = false;
        if (this._messageId !== "__no_edit__") this._messageId = undefined;
      }

      if (gotDone) break;

      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async _sendOrEdit(text: string, finalize: boolean): Promise<void> {
    const clean = this._cleanDisplay(text);
    if (!clean.trim() && !finalize) return;
    if (!this._alreadySent && clean.length < MIN_NEW_MSG_CHARS && !finalize) return;

    if (this._messageId && this._editSupported) {
      const result = await this._adapter.editMessage(this._chatId, this._messageId, clean);
      if (result.success) {
        this._floodStrikes = 0;
        this._lastSentText = clean;
        if (finalize) this._finalResponseSent = true;
        return;
      }
      if (this._isFlood(result.error)) {
        this._floodStrikes++;
        this._editInterval = Math.min(this._editInterval * 2, 10);
        if (this._floodStrikes < MAX_FLOOD_STRIKES) return;
      }
      this._editSupported = false;
      return;
    }

    const result = await this._adapter.send(this._chatId, clean, { threadId: this._threadId });
    if (result.success) {
      this._messageId = result.messageId ?? "__no_edit__";
      this._messageCreatedAt = Date.now();
      this._alreadySent = true;
      this._lastSentText = clean;
      if (!result.messageId) this._editSupported = false;
      if (finalize) this._finalResponseSent = true;
    }
  }

  private _cleanDisplay(text: string): string {
    return text.replace(/MEDIA:<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  private _isFlood(error?: string): boolean {
    if (!error) return false;
    const lower = error.toLowerCase();
    return lower.includes("flood") || lower.includes("retry") || lower.includes("rate");
  }
}
