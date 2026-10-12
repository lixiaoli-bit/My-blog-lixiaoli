import {
  REF_MIME,
  sameSource,
  type SourceTarget,
  type MapSource,
  type MapPayload,
} from "@/lib/mindmap-types";
import { activeAiEditor } from "@/lib/ai-editor-bridge";
import { revealBodyHeading } from "@/lib/body-heading-folding";
import { writeMapDrag } from "@/lib/mindmap-drag";
import "@/styles/article-mindmap-controls.css";
const pageId = crypto.randomUUID();
let navigation: BroadcastChannel | null = null;
let navigationSequence = 0;
let highlight: HTMLElement | null = null;
let highlightTimer = 0;
let clearDrag: (() => void) | null = null;
declare global {
  interface Window {
    __mindmapFlush?: (source: SourceTarget) => Promise<boolean>;
    __liveMindmapFlush?: (source: SourceTarget) => Promise<boolean>;
  }
}
let observer: MutationObserver | null = null,
  currentKey = "",
  activeSource: (MapSource & { canEdit: boolean }) | null = null,
  requestId = 0,
  controller: AbortController | null = null,
  scheduled = 0;
function target(): SourceTarget | null {
  const data = document.getElementById("doc-detail-data"),
    workspace = document.querySelector<HTMLElement>("[data-article-domain]");
  if (data?.dataset.activeNode)
    return {
      domain: workspace?.dataset.articleDomain === "docs" ? "doc" : "article",
      targetId: data.dataset.activeNode,
    };
  const publicArticle =
    document.querySelector<HTMLElement>("[data-map-article]");
  return publicArticle
    ? { domain: "article", targetId: publicArticle.dataset.mapArticle! }
    : null;
}
function body(): Element | null {
  return (
    document.getElementById("doc-article") ??
    document.querySelector("article.prose") ??
    document.querySelector("article")
  );
}
async function request(url: string, value?: unknown) {
  const response = await fetch(
      url,
      value
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(value),
          }
        : undefined,
    ),
    result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败");
  return result;
}
function message(text: string) {
  let toast = document.getElementById("article-map-message");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "article-map-message";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  window.setTimeout(() => toast?.remove(), 7000);
}
function mapWindow(source: SourceTarget) {
  return window.open(
    `/mindmaps?${new URLSearchParams(source as unknown as Record<string, string>)}`,
    `article-mindmap-${source.domain}-${source.targetId}`,
    "popup,width=1280,height=850",
  );
}
function reference(element: HTMLElement, quote?: string) {
  const block = activeSource?.blocks.find(
    (b) => b.blockId === element.dataset.sourceBlock,
  );
  if (!block || !activeSource) throw new Error("内容块尚未读取，请稍候重试");
  return {
    version: 1 as const,
    source: { domain: activeSource.domain, targetId: activeSource.targetId },
    blockId: block.blockId,
    fingerprint: block.fingerprint,
    quote: quote || "",
    text: quote?.slice(0, 80) || block.title,
  };
}
async function add(value: ReturnType<typeof reference>) {
  const popup = mapWindow(value.source);
  try {
    if (!(await window.__mindmapFlush!(value.source)))
      throw new Error("原文保存失败，请先处理保存问题");
    const result = await request("/api/mindmaps/ensure", {
        source: value.source,
      }),
      map = result.map as MapPayload;
    await request(`/api/mindmaps/${map.id}/refs`, {
      ...value,
      revision: map.revision,
      version: map.version,
    });
    const channel = new BroadcastChannel(`mindmap:${map.id}`);
    channel.postMessage({ type: "saved", revision: map.revision + 1 });
    channel.close();
    popup?.focus();
    message("已加入导图，名称可自由修改");
  } catch (e) {
    message(`${(e as Error).message}；原文和选区未改变，请重试`);
  }
}
function locate() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id.startsWith("block-")) return false;
  const element = body()?.querySelector<HTMLElement>(
    `[data-source-block="${CSS.escape(id.slice(6))}"]`,
  );
  if (!element) return false;
  let parent: HTMLElement | null = element;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (parent.classList.contains("md-tabs-panel")) {
      const tabs = parent.closest(".md-tabs"),
        index = Array.from(
          tabs?.querySelectorAll(":scope > .md-tabs-panel") ?? [],
        ).indexOf(parent);
      tabs?.querySelectorAll<HTMLElement>(".md-tabs-tab")[index]?.click();
    }
    parent = parent.parentElement;
  }
  revealBodyHeading(element);
  element.scrollIntoView({
    block: "center",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  clearTimeout(highlightTimer);
  highlight?.classList.remove("map-source-highlight");
  highlight = element;
  element.classList.add("map-source-highlight");
  highlightTimer = window.setTimeout(() => {
    element.classList.remove("map-source-highlight");
    if (highlight === element) highlight = null;
  }, 2500);
  return true;
}
function decorate() {
  if (!activeSource) return;
  const keys = new Map(activeSource.blocks.map((block) => [block.key, block]));
  body()
    ?.querySelectorAll<HTMLElement>("[data-source-key]")
    .forEach((element) => {
      const block = keys.get(element.dataset.sourceKey!);
      if (!block) return;
      element.dataset.sourceBlock = block.blockId;
      if (
        !["callout", "blockquote", "interactive-html"].includes(block.kind) ||
        !activeSource!.canEdit ||
        element.querySelector(
          ":scope > .map-card-tools, :scope > summary > .map-card-tools",
        )
      )
        return;
      const tools = document.createElement("span");
      tools.className = "map-card-tools";
      tools.contentEditable = "false";
      const drag = document.createElement("button");
      drag.type = "button";
      drag.textContent = "⠿ 拖入导图";
      drag.title = "拖入关联思维导图";
      drag.setAttribute("aria-label", "拖拽引用卡片到思维导图");
      drag.draggable = true;
      drag.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
      });
      drag.addEventListener("dragstart", (event) => {
        event.stopPropagation();
        clearDrag?.();
        try {
          const value = reference(element);
          if (!event.dataTransfer) return;
          writeMapDrag(event.dataTransfer, value);
          event.dataTransfer.effectAllowed = "copy";
          const ghost = document.createElement("div");
          ghost.className = "map-card-drag-preview";
          const label = document.createElement("strong");
          label.textContent = value.text.slice(0, 60);
          const hint = document.createElement("span");
          hint.textContent = "放到导图节点上，加入其下方";
          ghost.append(label, hint);
          document.body.appendChild(ghost);
          event.dataTransfer.setDragImage(ghost, 20, 20);
          element.classList.add("map-card-dragging");
          clearDrag = () => {
            element.classList.remove("map-card-dragging");
            ghost.remove();
            clearDrag = null;
          };
        } catch (error) {
          event.preventDefault();
          message((error as Error).message);
        }
      });
      drag.addEventListener("dragend", () => clearDrag?.());
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "＋导图";
      plus.title = "将完整卡片加入导图";
      plus.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        void add(reference(element));
      });
      tools.append(drag, plus);
      (element.querySelector(":scope > summary") ?? element).appendChild(tools);
    });
}
async function refresh() {
  const source = target(),
    key = source ? `${source.domain}:${source.targetId}` : "";
  if (!source) return;
  const button = document.querySelector<HTMLButtonElement>("[data-map-open]");
  if (button) {
    button.disabled = false;
    button.dataset.mapDomain = source.domain;
    button.dataset.mapTarget = source.targetId;
  }
  if (currentKey === key && activeSource) {
    decorate();
    return;
  }
  currentKey = key;
  activeSource = null;
  const id = ++requestId;
  try {
    const result = await request(
      `/api/mindmaps/source?${new URLSearchParams(source as unknown as Record<string, string>)}`,
    );
    if (id !== requestId || currentKey !== key) return;
    activeSource = result.source;
    if (button) button.hidden = !result.source.canEdit && !result.map;
    decorate();
    locate();
  } catch (e) {
    if (button) button.disabled = true;
    if (location.hash.startsWith("#block-")) message((e as Error).message);
  }
}
function init() {
  observer?.disconnect();
  controller?.abort();
  controller = new AbortController();
  currentKey = "";
  activeSource = null;
  const signal = controller.signal;
  window.__mindmapFlush = async (source) => {
    const editor = activeAiEditor();
    if (editor && sameSource(source, editor)) return editor.flush();
    if (window.__liveMindmapFlush) return window.__liveMindmapFlush(source);
    if (window.__docInlineEditor?.flush)
      return window.__docInlineEditor.flush();
    return true;
  };
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-map-open]") : null;
      if (!button) return;
      const source = target();
      if (source) mapWindow(source);
    },
    { signal },
  );
  window.addEventListener("hashchange", () => locate(), { signal });
  navigation?.close();
  navigation = new BroadcastChannel("mindmap-source-navigation");
  navigation.onmessage = async (event) => {
    const value = event.data,
      source = target();
    if (!source || !value?.source || !sameSource(source, value.source)) return;
    const channel = navigation;
    if (value.type === "find") {
      if (value.intent === "navigate" && !activeSource) await refresh();
      if (channel !== navigation || !sameSource(source, target() ?? { domain: "article", targetId: "" })) return;
      if (value.intent === "navigate" && !activeSource) return;
      navigation?.postMessage({
        type: "ready",
        requestId: value.requestId,
        pageId,
      });
      return;
    }
    if (value.type === "flush" && value.pageId === pageId) {
      navigation?.postMessage({
        type: "flushed",
        pageId,
        requestId: value.requestId,
        ok: await window.__mindmapFlush!(source),
      });
      return;
    }
    if (
      value.type !== "navigate" ||
      value.pageId !== pageId ||
      !activeSource ||
      typeof value.url !== "string" ||
      !value.url.startsWith(activeSource.url + "#block-")
    )
      return;
    const sequence = ++navigationSequence;
    const saved = await window.__mindmapFlush!(source);
    if (sequence !== navigationSequence || channel !== navigation || !sameSource(source, target() ?? { domain: "article", targetId: "" })) {
      if (channel === navigation && !signal.aborted)
        channel?.postMessage({ type: "superseded", requestId: value.requestId, pageId });
      return;
    }
    if (!saved) {
      message("原文保存失败，跳转已暂停；请先处理保存问题");
      navigation?.postMessage({
        type: "blocked",
        requestId: value.requestId,
        pageId,
      });
      return;
    }
    const desktop = (
      window as Window & { desktop?: { focusWindow?: () => Promise<void> } }
    ).desktop;
    void desktop?.focusWindow?.();
    window.focus();
    const url = new URL(value.url, location.origin);
    if (url.pathname === location.pathname && url.search === location.search) {
      // Setting an unchanged hash emits no event. Every click must locate explicitly.
      history.replaceState(history.state, "", url);
      if (!locate()) {
        currentKey = "";
        await refresh();
        if (!locate()) message("未找到原文位置，请重新关联此节点");
      }
    } else location.href = value.url;
    navigation?.postMessage({ type: "navigated", requestId: value.requestId, pageId });
  };
  document.addEventListener(
    "dragstart",
    (event) => {
      if (event.target instanceof Element && event.target.closest(".map-card-tools")) return;
      const selection = window.getSelection(),
        quote = selection?.toString().trim(),
        element = selection?.anchorNode?.parentElement?.closest<HTMLElement>(
          "[data-source-block]",
        );
      if (
        !quote ||
        !element ||
        !activeSource?.canEdit ||
        selection?.focusNode?.parentElement?.closest("[data-source-block]") !==
          element
      )
        return;
      const value = reference(element, quote);
      event.dataTransfer?.setData(REF_MIME, JSON.stringify(value));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    },
    { signal },
  );
  document.addEventListener(
    "mouseup",
    () => {
      document.getElementById("map-selection-add")?.remove();
      const selection = window.getSelection(),
        quote = selection?.toString().trim();
      if (!quote || !activeSource?.canEdit) return;
      const start = selection!.anchorNode?.parentElement?.closest<HTMLElement>(
          "[data-source-block]",
        ),
        end = selection!.focusNode?.parentElement?.closest(
          "[data-source-block]",
        );
      if (!start || start !== end) return;
      const value = reference(start, quote),
        button = document.createElement("button");
      button.id = "map-selection-add";
      button.textContent = "选区加入导图";
      button.type = "button";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        void add(value);
        button.remove();
      });
      document.body.appendChild(button);
    },
    { signal },
  );
  observer = new MutationObserver((records) => {
    const contentChanged = records.some(
      (record) =>
        record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            !(
              node instanceof Element &&
              (node.matches(".map-card-tools") ||
                node.closest(".map-card-tools"))
            ),
        ),
    );
    if (contentChanged) {
      currentKey = "";
      activeSource = null;
    }
    clearTimeout(scheduled);
    scheduled = window.setTimeout(() => {
      void refresh();
      if (location.hash.startsWith("#block-")) locate();
    }, 120);
  });
  const content = body(),
    data = document.getElementById("doc-detail-data");
  const liveSource = document.getElementById("map-live-editor-source");
  if (liveSource)
    observer.observe(liveSource, {
      attributes: true,
      attributeFilter: ["data-map-article"],
    });
  if (content) observer.observe(content, { childList: true, subtree: true });
  if (data)
    observer.observe(data, {
      attributes: true,
      attributeFilter: ["data-active-node", "data-raw-title"],
    });
  void refresh();
}
document.addEventListener("astro:page-load", init);
document.addEventListener("astro:before-swap", () => {
  observer?.disconnect();
  controller?.abort();
  navigation?.close();
  navigation = null;
  clearDrag?.();
  clearTimeout(scheduled);
  clearTimeout(highlightTimer);
  highlight?.classList.remove("map-source-highlight");
  highlight = null;
  ++navigationSequence;
  ++requestId;
});
if (document.readyState !== "loading") init();
