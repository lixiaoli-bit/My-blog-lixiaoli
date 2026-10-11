import { afterEach, describe, expect, it, vi } from "vitest";
import { reuseSourceWindow } from "../src/lib/mindmap-navigation";

class Channel {
  static latest: Channel;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  posted: Record<string, unknown>[] = [];
  constructor() { Channel.latest = this; }
  postMessage(value: Record<string, unknown>) { this.posted.push(value); }
  close() { this.closed = true; }
  reply(type: string) {
    this.onmessage?.({ data: { type, pageId: "article-window", requestId: this.posted[0]!.requestId } });
  }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("source window navigation", () => {
  const source = { domain: "doc" as const, targetId: "article" };
  it("repeated successful links leave no fallback timers or channels running", async () => {
    vi.useFakeTimers(); vi.stubGlobal("BroadcastChannel", Channel);
    for (let i = 0; i < 4; i++) {
      const result = reuseSourceWindow(source, "/doc/book?article=article#block-card");
      const channel = Channel.latest;
      channel.reply("ready"); channel.reply("navigated");
      await expect(result).resolves.toBe(true);
      expect(channel.closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
  it("a newer click cancels the prior request without opening a stale fallback", async () => {
    vi.useFakeTimers(); vi.stubGlobal("BroadcastChannel", Channel);
    const abort = new AbortController();
    const first = reuseSourceWindow(source, "/doc/book#block-old", abort.signal);
    const previous = Channel.latest;
    previous.reply("ready"); abort.abort();
    await expect(first).resolves.toBe(true);
    previous.reply("navigated");
    const next = reuseSourceWindow(source, "/doc/book#block-new");
    Channel.latest.reply("ready"); Channel.latest.reply("navigated");
    await expect(next).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("only a missing article window triggers a new-window fallback", async () => {
    vi.useFakeTimers(); vi.stubGlobal("BroadcastChannel", Channel);
    const result = reuseSourceWindow(source, "/doc/book#block-card");
    const channel = Channel.latest;
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe(false);
    expect(channel.closed).toBe(true);
  });
});
