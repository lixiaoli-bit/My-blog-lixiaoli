import type { SourceTarget } from "./mindmap-types";
export async function flushSourceWindows(
  source: SourceTarget,
): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return true;
  const channel = new BroadcastChannel("mindmap-source-navigation"),
    requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const pending = new Set<string>();
    let collected = false,
      ok = true;
    const finish = (value: boolean) => {
      clearTimeout(timeout);
      clearTimeout(discovery);
      channel.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(false), 10000);
    const discovery = setTimeout(() => {
      collected = true;
      if (!pending.size) finish(ok);
    }, 350);
    channel.onmessage = (event) => {
      const value = event.data;
      if (value?.requestId !== requestId) return;
      if (value.type === "ready" && !collected) {
        pending.add(value.pageId);
        channel.postMessage({
          type: "flush",
          pageId: value.pageId,
          requestId,
          source,
        });
      }
      if (value.type === "flushed") {
        pending.delete(value.pageId);
        ok &&= value.ok === true;
        if (collected && !pending.size) finish(ok);
      }
    };
    channel.postMessage({ type: "find", intent: "flush", requestId, source });
  });
}
/** Request a matching article window, then address exactly that window. Works in Electron too. */
export async function reuseSourceWindow(
  source: SourceTarget,
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return false;
  const channel = new BroadcastChannel("mindmap-source-navigation"),
    requestId = crypto.randomUUID();
  try {
    return await new Promise<boolean>((resolve) => {
      let selected = "";
      let timeout: ReturnType<typeof setTimeout>;
      const finish = (handled: boolean) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancelled);
        channel.onmessage = null;
        resolve(handled);
      };
      // A superseded click must not open a fallback window.
      const cancelled = () => finish(true);
      if (signal?.aborted) return finish(true);
      signal?.addEventListener("abort", cancelled, { once: true });
      timeout = setTimeout(() => finish(false), 1500);
      channel.onmessage = (event) => {
        if (event.data?.requestId !== requestId) return;
        if (event.data.type === "ready" && !selected) {
          selected = event.data.pageId;
          clearTimeout(timeout);
          channel.postMessage({
            type: "navigate",
            pageId: selected,
            requestId,
            source,
            url,
          });
          timeout = setTimeout(() => finish(false), 10000);
        }
        if (event.data.type === "navigated" && event.data.pageId === selected)
          finish(true);
        if (event.data.type === "blocked" && event.data.pageId === selected)
          finish(true); // Save failure is shown in the article; don't open a stale duplicate.
        if (event.data.type === "superseded" && event.data.pageId === selected)
          finish(true);
      };
      channel.postMessage({ type: "find", intent: "navigate", requestId, source });
    });
  } finally {
    channel.close();
  }
}
