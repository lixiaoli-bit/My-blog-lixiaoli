import DOMPurify from "dompurify";
import { openInteractivePreview } from './interactive-html-client';
import type { InteractiveBlock } from './interactive-html';
import { KATEX_ALLOWED_TAGS } from "./math-sanitize";
import { walkMap, type MapDocument, type MapNode } from "./mindmap-types";

export interface MarkdownNode {
  customTextWidth?: number;
  width: number;
  height: number;
  getData(): MapNode["data"];
  getStyle(key: string): unknown;
  reRender(): boolean;
  group: { node: SVGElement } | null;
}
interface MarkdownEngine {
  renderer: { nodeCache: Record<string, MarkdownNode> };
  getData(full: true): unknown;
  render(): void;
}
type Result = { uid: string; text: string; html?: string; error?: string; interactiveBlocks?: InteractiveBlock[] };
// Plain labels retain the engine's text rendering and inline editor.
export function hasNodeMarkdown(text: string): boolean {
  return /[\n`\uFF40\u02CB\u2035*_~$<>\[\]#|={}+]|:::|https?:\/\/|\bwww\.|^\s*(- |\d+[.)] )|\\[()[\]]/.test(
    text,
  );
}

/** HTML is ephemeral; data.text remains the only stored name. */
export class MindmapMarkdown {
  private cache = new Map<string, { html?: string; error?: string; interactiveBlocks?: InteractiveBlock[] }>();
  private pending = new Set<string>();
  private inflight = new Set<string>();
  private states = new Map<string, { text: string; html: string }>();
  private observed = new Set<HTMLElement>();
  private dirty = new Set<string>();
  private observer: ResizeObserver;
  private abort = new AbortController();
  private engine: MarkdownEngine | null = null;
  private frame = 0;
  private busy = false;
  private disposed = false;
  private initialLayout = true;
  constructor(
    private mapId: string,
    private notify: (message: string) => void,
    private onInitialLayout: () => void = () => {},
    private linkedInteractive: (data: MapNode['data']) => InteractiveBlock | undefined = () => undefined,
  ) {
    this.observer = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        const root = target as HTMLElement;
        if (!root.isConnected || !root.dataset.mapNode) continue;
        const node = this.engine?.renderer.nodeCache[root.dataset.mapNode];
        if (!node?.group?.node.contains(root)) continue;
        // Compare layout pixels with the engine's border-box measurement.
        // Re-observing or replacing a root must not trigger another full redraw.
        const width = root.offsetWidth, height = root.offsetHeight;
        if (width > 0 && height > 0 &&
            (Math.abs(width - node.width) > 1 || Math.abs(height - node.height) > 1)) {
          this.remember(root);
          this.refresh([root.dataset.mapNode]);
        }
      }
    });
  }
  attach(engine: MarkdownEngine) {
    this.engine = engine;
    this.sync();
    if (!this.pending.size && !this.busy) this.initialLayout = false;
  }
  private remember(root: HTMLElement) {
    if (root.dataset.mapNode)
      this.states.set(root.dataset.mapNode, {
        text: root.dataset.sourceText!,
        html: root.innerHTML,
      });
  }
  private size(root: HTMLElement, node: MarkdownNode): boolean {
    // The engine's custom width describes the entire foreignObject, including
    // padding. Measure at that same width rather than the default label cap.
    const width = node.customTextWidth ?? node.getData().customTextWidth;
    const custom = typeof width === "number" && Number.isFinite(width) && width > 0;
    const next = custom ? `${width}px` : "";
    const changed = root.style.width !== next;
    root.style.width = next;
    root.style.maxWidth = custom ? "none" : "";
    root.style.minWidth = custom ? "0" : "";
    root.style.paddingInline = custom ? `${Math.min(30, width / 4)}px` : "";
    return changed;
  }
  create(node: MarkdownNode): HTMLElement | null {
    const { text, uid } = node.getData();
    const linked = this.linkedInteractive(node.getData());
    if (uid && linked && !hasNodeMarkdown(text)) {
      const root = document.createElement('div'); root.className = 'map-node-markdown prose';
      this.size(root, node); root.dataset.mapNode = uid; root.dataset.sourceText = text;
      const title = document.createElement('strong'); title.textContent = text;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '打开演示'; button.style.cssText = 'display:block;margin-top:5px;border:1px solid currentColor;padding:3px 6px;background:transparent;color:inherit;cursor:pointer';
      button.dataset.interactiveEntry = '';
      root.append(title, button);
      for (const event of ['mousedown','pointerdown','dblclick']) button.addEventListener(event, value => value.stopPropagation());
      button.addEventListener('click', event => { event.stopPropagation(); openInteractivePreview(linked); });
      button.addEventListener('keydown', event => event.stopPropagation());
      return root;
    }
    if (!uid || !hasNodeMarkdown(text)) return null;
    const result = this.cache.get(text);
    if (!result?.html) return null;
    const root = document.createElement("div");
    root.className = "map-node-markdown prose";
    this.size(root, node);
    root.dataset.mapNode = uid;
    root.dataset.sourceText = text;
    root.style.fontFamily = String(node.getStyle("fontFamily") || "sans-serif");
    root.style.fontSize = `${node.getStyle("fontSize") || 15}px`;
    root.style.fontWeight = String(node.getStyle("fontWeight") || "normal");
    root.style.fontStyle = String(node.getStyle("fontStyle") || "normal");
    root.style.color = String(node.getStyle("color") || "inherit");
    root.style.setProperty("--tw-prose-body", root.style.color);
    root.style.setProperty("--tw-prose-headings", root.style.color);
    const previous = this.states.get(uid);
    root.innerHTML = previous?.text === text ? previous.html : result.html;
    root.querySelectorAll('[data-interactive-entry]').forEach(element => element.remove());
    if (linked) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '打开演示';
      button.dataset.interactiveEntry = ''; button.style.cssText = 'display:block;margin-top:5px;border:1px solid currentColor;padding:3px 6px;background:transparent;color:inherit;cursor:pointer';
      root.append(button);
    }
    // Canvas cards are static entries. Never mount a runner in foreignObject.
    root.querySelectorAll<HTMLElement>('[data-interactive-card]').forEach((card, index) => {
      const block = result.interactiveBlocks?.[index];
      if (!block) return;
      card.querySelectorAll('[data-interactive-payload],details,[data-interactive-stage]').forEach(element => element.remove());
      const actions = card.querySelector('.interactive-html-actions');
      if (actions) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '打开演示';
        button.dataset.interactiveOpen = String(index); actions.replaceChildren(button);
      }
      card.querySelector('[data-interactive-status]')?.replaceChildren(block.error || '交互演示');
    });
    if (previous?.text !== text) {
      const ids = new Map<string, string>();
      root.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
        const old = element.id;
        element.id = `map-${uid}-${old}`;
        ids.set(old, element.id);
      });
      root
        .querySelectorAll<HTMLAnchorElement>('a[href^="#"]')
        .forEach((link) => {
          const id = ids.get(link.getAttribute("href")!.slice(1));
          if (id) link.setAttribute("href", `#${id}`);
        });
      root.querySelectorAll<HTMLElement>("[data-copy]").forEach((button) => {
        if (!button.textContent?.trim()) button.append("复制");
      });
    }
    // This standalone page has no article SVG sprite. Text controls stay
    // visible in the canvas and in exported foreignObjects.
    root.querySelectorAll<HTMLElement>("pre.code-block [data-copy]").forEach((button) => {
      button.textContent = "复制";
    });
    root.querySelectorAll<HTMLElement>("pre.code-block [data-code-toggle]").forEach((button) => {
      button.querySelectorAll("svg").forEach((icon) => icon.remove());
    });
    root.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
      if (!link.getAttribute("href")?.startsWith("#")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
    const control = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("a,button,input,select,textarea,summary");
    for (const event of ["mousedown", "pointerdown", "dblclick"])
      root.addEventListener(event, (e) => {
        if (control(e.target)) e.stopPropagation();
      });
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !control(target)) return;
      event.stopPropagation();
      const interactive = target.closest<HTMLElement>('[data-interactive-open]');
      if (target.closest('[data-interactive-entry]') && linked) {
        event.preventDefault(); openInteractivePreview(linked); return;
      }
      if (interactive) {
        event.preventDefault();
        const block = this.cache.get(text)?.interactiveBlocks?.[Number(interactive.dataset.interactiveOpen)];
        if (block) openInteractivePreview(block);
        return;
      }
      const link = target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (link) {
        event.preventDefault();
        const destination = [
          ...root.querySelectorAll<HTMLElement>("[id]"),
        ].find((element) => `#${element.id}` === link.getAttribute("href"));
        if (destination) {
          destination.tabIndex = -1;
          destination.focus({ preventScroll: true });
        }
      }
      const tab = target.closest<HTMLElement>('[role="tab"]');
      if (tab) {
        const group = tab.closest(".md-tabs")!;
        const tabs = [
          ...group.querySelectorAll<HTMLElement>(
            ':scope > .md-tabs-nav [role="tab"]',
          ),
        ];
        const panels = [
          ...group.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]'),
        ];
        const index = tabs.indexOf(tab);
        tabs.forEach((item, i) => {
          item.setAttribute("aria-selected", String(i === index));
          item.tabIndex = i === index ? 0 : -1;
        });
        panels.forEach((panel, i) => {
          panel.hidden = i !== index;
        });
      }
      const code = target
        .closest<HTMLElement>("[data-code-toggle]")
        ?.closest<HTMLElement>(".code-block");
      if (code) {
        const collapsed = code.dataset.collapsed !== "true";
        if (collapsed) code.dataset.collapsed = "true";
        else delete code.dataset.collapsed;
        const button = code.querySelector<HTMLElement>("[data-code-toggle]")!;
        button.setAttribute("aria-expanded", String(!collapsed));
        button.title = collapsed ? "展开代码" : "收起代码";
        const label = button.querySelector("[data-toggle-text]");
        if (label) label.textContent = collapsed ? "展开" : "收起";
      }
      const spoiler = target.closest<HTMLElement>("[data-spoiler]");
      if (spoiler)
        spoiler.setAttribute(
          "aria-expanded",
          String(spoiler.getAttribute("aria-expanded") !== "true"),
        );
      const copy = target.closest<HTMLElement>("[data-copy],[data-callout-copy]");
      if (copy) {
        const content = copy
          .closest("[data-code-block],.callout")
          ?.querySelector("code,.callout-body");
        const text = copy.dataset.calloutSource ?? content?.textContent;
        if (text != null && navigator.clipboard?.writeText)
          void navigator.clipboard.writeText(text)
            .catch(() => this.notify("复制失败，请手动选择并复制"));
        else this.notify("复制不可用，请手动选择并复制");
      }
      this.remember(root);
    });
    root.addEventListener("keydown", (event) => {
      if (!control(event.target)) return;
      event.stopPropagation();
      const tab = (event.target as Element).closest<HTMLElement>(
        '[role="tab"]',
      );
      if (
        tab &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        const tabs = [
          ...tab
            .closest(".md-tabs")!
            .querySelectorAll<HTMLElement>(
              ':scope > .md-tabs-nav [role="tab"]',
            ),
        ];
        const index =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (tabs.indexOf(tab) +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  tabs.length) %
                tabs.length;
        tabs[index]?.click();
        tabs[index]?.focus({ preventScroll: true });
      }
    });
    root.addEventListener("toggle", () => this.remember(root), true);
    return root;
  }
  sync() {
    if (!this.engine || this.disposed) return;
    const names = new Set<string>();
    walkMap((this.engine.getData(true) as MapDocument).root, (node) => {
      const { text, uid } = node.data;
      names.add(text);
      if (
        uid &&
        hasNodeMarkdown(text) &&
        !this.cache.has(text) &&
        !this.inflight.has(text)
      )
        this.pending.add(text);
    });
    // Bound cache lifetime to this document, including hidden branches.
    for (const text of this.cache.keys())
      if (!names.has(text)) this.cache.delete(text);
    for (const text of this.pending)
      if (!names.has(text)) this.pending.delete(text);
    const visible = new Set<HTMLElement>();
    // Measurement clones must not receive keyboard focus or appear to screen readers.
    const canvas = Object.values(this.engine.renderer.nodeCache)
      .find((node) => node.group?.node.isConnected)
      ?.group?.node.closest(".map-canvas");
    canvas
      ?.querySelectorAll<HTMLElement>(".map-node-markdown")
      .forEach((root) => {
        if (!root.closest("svg") && root.parentElement) {
          root.parentElement.inert = true;
          root.parentElement.setAttribute("aria-hidden", "true");
        }
      });
    for (const node of Object.values(this.engine.renderer.nodeCache)) {
      const root =
        node.group?.node.querySelector<HTMLElement>(".map-node-markdown");
      if (root?.isConnected) {
        if (this.size(root, node)) this.refresh([node.getData().uid!]);
        visible.add(root);
        if (!this.observed.has(root)) this.observer.observe(root);
      }
      // A cached server response can arrive before the engine's first SVG
      // render. Refresh once the raw node actually exists on the canvas.
      const { text } = node.getData();
      if (node.group?.node.isConnected && this.cache.get(text)?.html &&
          (!root || root.dataset.sourceText !== text)) this.refresh([node.getData().uid!]);
    }
    for (const root of this.observed)
      if (!visible.has(root)) this.observer.unobserve(root);
    this.observed = visible;
    void this.request();
  }
  private async request() {
    if (this.busy || this.disposed || !this.pending.size || !this.engine)
      return;
    this.busy = true;
    const nodes: { uid: string; text: string }[] = [];
    walkMap((this.engine.getData(true) as MapDocument).root, (node) => {
      const { uid, text } = node.data;
      if (uid && this.pending.has(text) && nodes.length < 16) {
        this.pending.delete(text);
        this.inflight.add(text);
        nodes.push({ uid, text });
      }
    });
    try {
      if (!nodes.length) return;
      const response = await fetch(
        `/api/mindmaps/${encodeURIComponent(this.mapId)}/render`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodes }),
          signal: AbortSignal.any([
            this.abort.signal,
            AbortSignal.timeout(45000),
          ]),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "名称渲染失败");
      for (const node of result.nodes as Result[]) {
        const html = node.html
          ? DOMPurify.sanitize(node.html, {
              ADD_TAGS: [...KATEX_ALLOWED_TAGS],
              ADD_ATTR: ["xmlns", "target"],
              FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
            })
          : undefined;
        this.cache.set(node.text, { html, error: node.error, interactiveBlocks: node.interactiveBlocks });
        if (node.error) this.notify(node.error);
      }
      if (this.initialLayout) this.onInitialLayout();
      if (!this.pending.size) this.initialLayout = false;
      const received = new Set(nodes.map((node) => node.text));
      this.refresh(Object.values(this.engine.renderer.nodeCache)
        .filter((node) => received.has(node.getData().text))
        .map((node) => node.getData().uid!));
    } catch (error) {
      if (!this.disposed) {
        // Do not spin on a failing endpoint. A subsequent edit retries.
        for (const node of nodes)
          this.cache.set(node.text, { error: "unavailable" });
        this.notify(
          error instanceof Error ? error.message : "名称渲染失败，源码已保留",
        );
      }
    } finally {
      this.busy = false;
      for (const node of nodes) this.inflight.delete(node.text);
      if (!this.disposed && nodes.length) void this.request();
    }
  }
  private refresh(uids: Iterable<string>) {
    for (const uid of uids) this.dirty.add(uid);
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.engine || this.disposed) return;
      const dirty = [...this.dirty];
      this.dirty.clear();
      let changed = false;
      for (const uid of dirty) {
        const node = this.engine.renderer.nodeCache[uid];
        if (
          node?.group?.node.isConnected &&
          hasNodeMarkdown(node.getData().text)
        ) {
          node.reRender();
          changed = true;
        }
      }
      if (changed) this.engine.render();
    });
  }
  async ready() {
    this.sync();
    while (!this.disposed && (this.busy || this.frame))
      await new Promise((resolve) => setTimeout(resolve, 25));
    await document.fonts.ready;
  }
  destroy() {
    this.disposed = true;
    this.abort.abort();
    this.observer.disconnect();
    this.observed.clear();
    this.dirty.clear();
    cancelAnimationFrame(this.frame);
    this.cache.clear();
    this.states.clear();
    this.pending.clear();
    this.engine = null;
  }
}
