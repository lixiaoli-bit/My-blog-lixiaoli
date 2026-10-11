import { useEffect, useRef, useState } from "react";
import MindMapType from "simple-mind-map";
import "simple-mind-map/dist/simpleMindMap.esm.css";
import "@/styles/article-mindmap.css";
import {
  sameSource,
  walkMap,
  validateMapDocument,
  type MapDocument,
  type MapNode,
  type MapPayload,
  type SourceTarget,
  type SourceRef,
} from "@/lib/mindmap-types";
import { acceptsMapDrag, readMapDrag } from "@/lib/mindmap-drag";
import { MindmapSaveQueue, type PendingMap } from "@/lib/mindmap-save-queue";
import { guardAssociativeLine } from "@/lib/mindmap-engine-compat";
import { hasNodeMarkdown, MindmapMarkdown, type MarkdownNode } from "@/lib/mindmap-markdown";
import {
  prepareMarkdownExport,
  styleMarkdownExport,
} from "@/lib/mindmap-markdown-export";
import { readState, writeState } from "@/lib/theme";
import {
  reuseSourceWindow,
  flushSourceWindows,
} from "@/lib/mindmap-navigation";

type Node = {
  getData(): MapNode["data"];
  group: { node: SVGElement } | null;
  width: number;
  height: number;
  setText(text: string): void;
  getStyle(key: string): unknown;
  reRender(): boolean;
  isUseCustomNodeContent(): boolean;
};
type Engine = MindMapType & {
  updateData(data: MapNode): void;
  execCommand(command: string, ...args: unknown[]): void;
  renderer: {
    activeNodeList: Node[];
    nodeCache: Record<string, Node>;
    textEdit: {
      hideEditTextBox(): void;
      isShowTextEdit(): boolean;
      show(options: { node: Node; [key: string]: unknown }): unknown;
    };
    toggleActiveExpand(): void;
  };
  keyCommand: {
    removeShortcut(key: string): void;
    addShortcut(key: string, action: () => void): void;
  };
  associativeLine: { createLineFromActiveNode(): void };
  search: { search(text: string): void; endSearch(): void };
  setThemeConfig(config: Record<string, unknown>): void;
  setMode(mode: "readonly" | "edit"): void;
  view: MindMapType["view"] & {
    fit(getRect?: () => unknown, enlarge?: boolean, padding?: number): void;
  };
};
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, options),
    result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "请求失败"), {
      status: response.status,
      details: result.details,
    });
  return result;
}
const sendJson = (value: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const neoTheme = () => {
  const dark = document.documentElement.classList.contains("dark"),
    ink = dark ? "#fff6e5" : "#151511",
    paper = dark ? "#292c27" : "#fffaf1";
  const basic = {
    fillColor: paper,
    color: ink,
    borderColor: ink,
    borderWidth: 2,
    borderRadius: 4,
    shape: "rectangle",
    fontFamily: "Noto Sans SC Variable, sans-serif",
    fontSize: 15,
    paddingX: 30,
    paddingY: 12,
  };
  return {
    backgroundColor: dark ? "#20221f" : "#fbf7ee",
    lineColor: ink,
    lineWidth: 2,
    lineStyle: "straight",
    root: {
      ...basic,
      fillColor: "#ff541f",
      color: "#151511",
      fontSize: 20,
      fontWeight: "bold",
    },
    second: basic,
    node: basic,
  };
};
export default function MindMapWorkspace({
  mapId,
  source,
}: {
  mapId?: string;
  source?: SourceTarget;
}) {
  const [map, setMap] = useState<MapPayload | null>(null),
    [error, setError] = useState(""),
    [choices, setChoices] = useState<{ id: string; title: string }[]>([]);
  const [status, setStatus] = useState("正在读取…"),
    [selected, setSelected] = useState<Node | null>(null),
    [properties, setProperties] = useState(false),
    [help, setHelp] = useState(false);
  const [name, setName] = useState(""),
    [note, setNote] = useState(""),
    [search, setSearch] = useState(""),
    [broken, setBroken] = useState<string[]>([]),
    [zoom, setZoom] = useState(100);
  const [aiOpen, setAiOpen] = useState(false),
    [aiProgress, setAiProgress] = useState(""),
    [aiBusy, setAiBusy] = useState(false),
    [candidate, setCandidate] = useState<{
      branch: MapNode;
      revision: number;
      mapVersion: string;
      contentHash: string;
      editSequence: number;
    } | null>(null);
  const [conflict, setConflict] = useState(false),
    [pendingDrop, setPendingDrop] = useState<unknown>(null),
    [localDraft, setLocalDraft] = useState<PendingMap | null>(null);
  const [recoveries, setRecoveries] = useState<PendingMap[]>([]);
  const draftKey = useRef("");
  const jumpRequest = useRef<AbortController | null>(null);
  const dropNode = useRef<Node | null>(null);
  const [dropHint, setDropHint] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: Node | null;
  } | null>(null);
  const [aiRecheck, setAiRecheck] = useState(false);
  const [editingName, setEditingName] = useState<{
    uid: string;
    text: string;
  } | null>(null);
  const nameDraft = useRef<{ uid: string; text: string } | null>(null);
  const propertyNameDraft = useRef<{ uid: string; text: string } | null>(null);
  const markdown = useRef<MindmapMarkdown | null>(null);
  const finishName = (save = true) => {
    const draft = nameDraft.current;
    nameDraft.current = null;
    setEditingName(null);
    if (save && draft && current.current?.canEdit && !queue.current?.conflict) {
      const node = Object.values(engine.current?.renderer.nodeCache ?? {}).find(
        (n) => n.getData().uid === draft.uid,
      );
      if (node) engine.current?.execCommand("SET_NODE_TEXT", node, draft.text);
    }
    if (draft) canvas.current?.focus({ preventScroll: true });
  };
  const editName = (node: Node) => {
    if (!current.current?.canEdit || queue.current?.conflict) return;
    engine.current?.renderer.textEdit.hideEditTextBox();
    const data = node.getData();
    const draft = { uid: data.uid!, text: data.text };
    nameDraft.current = draft;
    setEditingName(draft);
  };
  const menuElement = useRef<HTMLDivElement>(null);
  const fitOnRender = useRef<(() => void) | null>(null);
  const captureDraft = useRef<(() => void) | null>(null);
  const canvas = useRef<HTMLDivElement>(null),
    engine = useRef<Engine | null>(null),
    queue = useRef<MindmapSaveQueue | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    sequence = useRef(0),
    cancelAi = useRef<AbortController | null>(null),
    current = useRef(map);
  current.current = map;
  const load = async (primaryId?: string) => {
    try {
      setError("");
      let payload: MapPayload;
      if (mapId)
        payload = (await api(`/api/mindmaps/${encodeURIComponent(mapId)}`)).map;
      else {
        if (source && !(await flushSourceWindows(source)))
          throw new Error("原文章尚未保存，请先处理保存问题");
        const found = await api(
          `/api/mindmaps/source?${new URLSearchParams(source as unknown as Record<string, string>)}`,
        );
        if (primaryId || (!found.map && found.source.canEdit))
          payload = (
            await api("/api/mindmaps/ensure", {
              method: "POST",
              ...sendJson({ source, primaryId }),
            })
          ).map;
        else if (found.map) payload = found.map;
        else throw new Error("这篇文章尚未创建思维导图");
      }
      setMap(payload);
      setChoices([]);
      setStatus(payload.canEdit ? "已保存" : "只读");
    } catch (e) {
      const issue = e as {
        message: string;
        details?: { choosePrimary?: typeof choices };
      };
      setChoices(issue.details?.choosePrimary ?? []);
      setError(issue.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!contextMenu) return;
    menuElement.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof globalThis.Node &&
        !menuElement.current?.contains(event.target)
      )
        setContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        canvas.current?.focus();
      }
    };
    const resized = () => setContextMenu(null);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resized);
    };
  }, [contextMenu]);
  const flush = async (commitEdit = false) => {
    if (commitEdit) captureDraft.current?.();
    clearTimeout(timer.current);
    return queue.current ? queue.current.flush() : true;
  };
  useEffect(() => {
    if (!map || !canvas.current) return;
    let disposed = false,
      mm: Engine | null = null,
      observer: ResizeObserver | null = null,
      themeObserver: MutationObserver | null = null,
      channel: BroadcastChannel | null = null;
    let savedSnapshot = "";
    let fitMode: "if-needed" | "always" | null = "if-needed";
    let initialPresentation = true;
    const interacted = () => {
      initialPresentation = false;
    };
    const interactionEvents = [
      "pointerdown",
      "keydown",
      "wheel",
      "drop",
    ] as const;
    interactionEvents.forEach((event) =>
      window.addEventListener(event, interacted, {
        capture: true,
        passive: true,
      }),
    );
    let fitting = false;
    let windowId = sessionStorage.getItem("mindmap-window-id");
    if (
      !windowId ||
      (
        performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined
      )?.type !== "reload"
    ) {
      windowId = crypto.randomUUID();
      sessionStorage.setItem("mindmap-window-id", windowId);
    }
    const prefix = `mindmap-draft:${map.id}`,
      storageKey = `${prefix}:${windowId}`;
    draftKey.current = storageKey;
    let persisted: PendingMap | null = null;
    try {
      if (map.canEdit) {
        persisted = JSON.parse(localStorage.getItem(storageKey) || "null");
        const others: PendingMap[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)!;
          if (key.startsWith(prefix) && key !== storageKey) {
            try {
              const draft = JSON.parse(localStorage.getItem(key)!);
              if (draft?.data?.root) others.push(draft);
            } catch {
              /* Ignore malformed drafts. */
            }
          }
        }
        setRecoveries(others);
      }
    } catch {
      /* Invalid or unavailable local storage. */
    }
    if (persisted) {
      setLocalDraft(persisted);
      if (
        persisted.revision !== map.revision ||
        persisted.version !== map.version
      )
        setConflict(true);
    }
    const persist = (snapshot: PendingMap | null) => {
      try {
        snapshot
          ? localStorage.setItem(storageKey, JSON.stringify(snapshot))
          : localStorage.removeItem(storageKey);
      } catch {
        setError("浏览器无法暂存修改，请及时导出 JSON 备份");
      }
    };
    queue.current = new MindmapSaveQueue(
      map.revision,
      async (snapshot) => {
        const result = await api(`/api/mindmaps/${map.id}`, {
          method: "PUT",
          ...sendJson(snapshot),
          keepalive: JSON.stringify(snapshot).length < 60000,
        });
        savedSnapshot = JSON.stringify(snapshot.data);
        queue.current!.version = result.map.version;
        if (!disposed)
          channel?.postMessage({
            type: "saved",
            revision: result.map.revision,
            version: result.map.version,
          });
        return result.map.revision;
      },
      persist,
      (label) => {
        if (!disposed) {
          setStatus(label);
          if (queue.current?.conflict) setConflict(true);
        }
      },
      map.version,
    );
    if (
      persisted &&
      (persisted.revision !== map.revision || persisted.version !== map.version)
    ) {
      queue.current.conflict = true;
      queue.current.pending = persisted;
      setStatus("本地草稿版本已过期 · 请先备份或另存副本");
    }
    const changed = () => {
      if (!mm || !map.canEdit || disposed || fitting) return;
      if (initialPresentation) {
        savedSnapshot = JSON.stringify(mm.getData(true));
        inspect();
        return;
      }
      sequence.current++;
      queue.current!.enqueue(
        mm.getData(true) as MapDocument,
        current.current!.title,
      );
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 800);
      inspect();
    };
    const inspect = () => {
      if (!mm) return;
      const source = current.current?.source;
      const failures: string[] = [];
      walkMap((mm.getData(true) as MapDocument).root, (node) => {
        const ref = node.data.sourceRef;
        if (
          node.data.referenceNeedsRepair ||
          (ref &&
            (!source ||
              !sameSource(ref, source) ||
              !source.blocks.some((block) => block.blockId === ref.blockId)))
        )
          failures.push(node.data.text);
      });
      setBroken(failures);
      for (const node of Object.values(mm.renderer.nodeCache)) {
        const group = node.group?.node;
        if (!group?.isConnected) continue;
        group.querySelector("[data-source-jump]")?.remove();
        const data = node.getData(),
          ref = data.sourceRef;
        if (!ref && !data.referenceNeedsRepair) continue;
        const valid =
          ref &&
          !data.referenceNeedsRepair &&
          source &&
          sameSource(ref, source) &&
          source.blocks.some((block) => block.blockId === ref.blockId);
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        svg.textContent = valid ? "↗" : "⚠";
        svg.setAttribute("x", String(node.width - 20));
        svg.setAttribute("y", String(node.height / 2 + 5));
        svg.setAttribute("font-size", "16");
        svg.setAttribute("fill", "#c6370c");
        svg.setAttribute("data-source-jump", data.uid || "ref");
        svg.setAttribute("role", "button");
        svg.setAttribute("tabindex", "0");
        svg.setAttribute("aria-label", "定位原文");
        svg.style.cursor = "pointer";
        const title = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title",
        );
        title.textContent = ref
          ? `${source?.title ?? "来源"} · ${ref.quote.slice(0, 100)}`
          : "引用待重新关联";
        svg.appendChild(title);
        const go = (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          if (valid && ref) void jump(ref);
          else {
            setSelected(node);
            setName(data.text);
            setNote(String(data.note ?? ""));
            setProperties(true);
          }
        };
        svg.addEventListener("click", go);
        svg.addEventListener("pointerdown", (event) => event.stopPropagation());
        svg.addEventListener("keydown", (event) => {
          if (["Enter", " "].includes(event.key)) go(event);
        });
        group.appendChild(svg);
      }
    };
    const rendered = () => {
      inspect();
      markdown.current?.sync();
      if (mm && initialPresentation && !queue.current?.pending)
        savedSnapshot = JSON.stringify(mm.getData(true));
      if (!mm || !canvas.current || !fitMode) return;
      const mode = fitMode;
      fitMode = null;
      const r = canvas.current.getBoundingClientRect();
      const overflow = Object.values(mm.renderer.nodeCache).some((node) => {
        if (!node.group?.node.isConnected) return false;
        const box = node.group.node.getBoundingClientRect();
        return (
          box.width > 0 &&
          (box.left < r.left + 12 ||
            box.right > r.right - 12 ||
            box.top < r.top + 12 ||
            box.bottom > r.bottom - 12)
        );
      });
      if (mode === "always" || overflow) {
        fitting = true;
        try {
          mm.resize();
          mm.view.fit(undefined, false, 24);
          // Initial automatic fitting is a presentation change. A clean map
          // must not become an unsaved draft merely because its fonts loaded.
          if (mode === "if-needed" && !queue.current?.pending)
            savedSnapshot = JSON.stringify(mm.getData(true));
        } finally {
          fitting = false;
        }
      }
    };
    fitOnRender.current = () => {
      fitMode = "always";
    };
    void (async () => {
      const [core, ...plugins] = await Promise.all([
        import("simple-mind-map"),
        import("simple-mind-map/src/plugins/Export.js"),
        import("simple-mind-map/src/plugins/Drag.js"),
        import("simple-mind-map/src/plugins/Select.js"),
        import("simple-mind-map/src/plugins/KeyboardNavigation.js"),
        import("simple-mind-map/src/plugins/AssociativeLine.js"),
        import("simple-mind-map/src/plugins/OuterFrame.js"),
        import("simple-mind-map/src/plugins/Search.js"),
      ]);
      if (disposed || !canvas.current) return;
      guardAssociativeLine(plugins[4]!.default);
      plugins.forEach((plugin) => core.default.usePlugin(plugin.default));
      const full =
        persisted &&
        persisted.revision === map.revision &&
        persisted.version === map.version
          ? persisted.data
          : map.data;
      const renderer = new MindmapMarkdown(map.id, setError, () => {
        fitMode = "if-needed";
      });
      markdown.current = renderer;
      mm = new core.default({
        el: canvas.current,
        enableShortcutOnlyWhenMouseInSvg: false,
        alwaysShowExpandBtn: true,
        isUseCustomNodeContent: true,
        customCreateNodeContent: (node: MarkdownNode) => renderer.create(node),
        handleBeingExportSvg: (svg: { node: SVGElement }) => {
          styleMarkdownExport(svg.node, canvas.current!);
          return svg;
        },
        data: full.root as import("simple-mind-map").MindMapNodeData,
        readonly:
          !map.canEdit ||
          Boolean(
            persisted &&
            (persisted.revision !== map.revision ||
              persisted.version !== map.version),
          ),
        layout: full.layout || "mindMap",
        theme: full.theme?.template || "default",
        themeConfig: Object.keys(full.theme?.config ?? {}).length
          ? full.theme!.config
          : neoTheme(),
        customCheckEnableShortcut: (event: KeyboardEvent) =>
          !event.isComposing &&
          event.keyCode !== 229 &&
          !document.querySelector("[data-map-modal]") &&
          (!(event.target as HTMLElement)?.closest(
            'input,textarea,select,[contenteditable="true"]',
          ) ||
            (event.target as HTMLElement).classList.contains(
              "smm-node-edit-wrap",
            )),
      }) as Engine;
      engine.current = mm;
      renderer.attach(mm);
      const textEdit = mm.renderer.textEdit;
      const originalShow = textEdit.show.bind(textEdit);
      const originalHide = textEdit.hideEditTextBox.bind(textEdit);
      textEdit.show = (options) => {
        if (!current.current?.canEdit || queue.current?.conflict) return;
        if (!hasNodeMarkdown(options.node.getData().text))
          return originalShow(options);
        editName(options.node);
      };
      textEdit.hideEditTextBox = () => {
        finishName();
        originalHide();
      };
      if (full.view) mm.view.setTransformData(full.view);
      savedSnapshot = JSON.stringify(mm.getData(true));
      const keys = mm.keyCommand;
      ["Control+Enter", "Shift+Tab", "Control+y", "Control+g", "/"].forEach(
        (key) => keys.removeShortcut(key),
      );
      keys.addShortcut("Control+Enter", () =>
        mm!.execCommand("INSERT_PARENT_NODE"),
      );
      keys.addShortcut("Control+Shift+z", () => mm!.execCommand("FORWARD"));
      keys.addShortcut("Control+/", () => mm!.renderer.toggleActiveExpand());
      keys.addShortcut("Control+Alt+/", () => {
        const doc = mm!.getData(true) as MapDocument;
        let expanded = false;
        walkMap(doc.root, (node) => {
          if (
            node !== doc.root &&
            node.children?.length &&
            node.data.expand !== false
          )
            expanded = true;
        });
        mm!.execCommand(expanded ? "UNEXPAND_ALL" : "EXPAND_ALL");
      });
      keys.addShortcut("Control+Shift+r", () =>
        mm!.associativeLine.createLineFromActiveNode(),
      );
      keys.addShortcut("Control+b", () => mm!.execCommand("ADD_OUTER_FRAME"));
      keys.addShortcut("Control+s", () => void flush(true));
      keys.addShortcut("Spacebar", () => {
        const list = mm!.renderer.activeNodeList;
        if (list.length === 1 && !textEdit.isShowTextEdit() && !nameDraft.current)
          textEdit.show({ node: list[0]! });
      });
      mm.on("data_change", changed);
      mm.on("view_data_change", changed);
      mm.on("node_tree_render_end", rendered);
      mm.on("layout_change", changed);
      mm.on("view_theme_change", changed);
      themeObserver = new MutationObserver(() => {
        mm?.setThemeConfig(neoTheme());
        changed();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      mm.on("node_active", (_node, list) => {
        const active = (list as Node[])?.[0] ?? null;
        setSelected(active);
        setName(active?.getData().text ?? "");
        setNote(String(active?.getData().note ?? ""));
      });
      mm.on("node_click", (node) => {
        if (current.current?.canEdit && !queue.current?.conflict) return;
        const active = node as Node;
        setSelected(active);
        setName(active.getData().text);
        setNote(String(active.getData().note ?? ""));
      });
      mm.on("scale", (scale) => setZoom(Math.round(Number(scale) * 100)));
      let previousSize = "";
      observer = new ResizeObserver(() => {
        if (!mm || !canvas.current) return;
        const size = `${canvas.current.clientWidth}:${canvas.current.clientHeight}`;
        if (previousSize === size) return;
        previousSize = size;
        mm.resize();
      });
      observer.observe(canvas.current);
      inspect();
      if (
        persisted &&
        persisted.revision === map.revision &&
        persisted.version === map.version
      ) {
        queue.current!.enqueue(full, persisted.title);
        void flush();
      }
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`mindmap:${map.id}`);
        channel.onmessage = async (event) => {
          if (
            event.data?.type !== "saved" ||
            (event.data.revision <= queue.current!.revision &&
              (!event.data.version ||
                event.data.version === queue.current!.version))
          )
            return;
          captureDraft.current?.();
          if (queue.current!.pending) {
            queue.current!.conflict = true;
            setConflict(true);
            setStatus("另一窗口已更新 · 本地修改已保留");
            return;
          }
          try {
            const remote = (await api(`/api/mindmaps/${map.id}`))
              .map as MapPayload;
            mm?.off("data_change", changed);
            mm?.off("view_data_change", changed);
            mm?.setFullData(remote.data);
            savedSnapshot = JSON.stringify(mm?.getData(true));
            queue.current!.revision = remote.revision;
            queue.current!.version = remote.version;
            current.current = remote;
            setMap(remote);
            mm?.on("data_change", changed);
            mm?.on("view_data_change", changed);
            inspect();
          } catch (e) {
            setError((e as Error).message);
          }
        };
      }
    })().catch((e) => setError(e.message));
    const capture = () => {
      if (!mm || !map.canEdit || queue.current?.conflict) return;
      if (initialPresentation && !queue.current?.pending) {
        savedSnapshot = JSON.stringify(mm.getData(true));
        return;
      }
      const draft = propertyNameDraft.current;
      propertyNameDraft.current = null;
      if (draft) {
        const node = Object.values(mm.renderer.nodeCache).find(
          (node) => node.getData().uid === draft.uid,
        );
        if (node) mm.execCommand("SET_NODE_TEXT", node, draft.text);
      }
      mm.renderer.textEdit.hideEditTextBox();
      const doc = mm.getData(true) as MapDocument,
        signature = JSON.stringify(doc);
      if (
        signature !== savedSnapshot &&
        signature !== JSON.stringify(queue.current?.pending?.data)
      )
        queue.current?.enqueue(doc, current.current!.title);
    };
    captureDraft.current = capture;
    const leave = (event: BeforeUnloadEvent) => {
      capture();
      if (queue.current?.pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const pagehide = () => {
      capture();
      if (queue.current?.pending) persist(queue.current.pending);
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", pagehide);
    return () => {
      disposed = true;
      clearTimeout(timer.current);
      cancelAi.current?.abort();
      jumpRequest.current?.abort();
      dropNode.current?.group?.node.classList.remove("map-drop-parent");
      pagehide();
      void queue.current?.flush();
      observer?.disconnect();
      markdown.current?.destroy();
      markdown.current = null;
      themeObserver?.disconnect();
      channel?.close();
      mm?.destroy();
      engine.current = null;
      captureDraft.current = null;
      fitOnRender.current = null;
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", pagehide);
      interactionEvents.forEach((event) =>
        window.removeEventListener(event, interacted, true),
      );
    };
  }, [map?.id]);
  useEffect(() => {
    if (engine.current)
      engine.current.setMode(map?.canEdit && !conflict ? "edit" : "readonly");
  }, [conflict, map?.canEdit]);
  const command = (key: string, ...args: unknown[]) => {
    if (map?.canEdit && !conflict) engine.current?.execCommand(key, ...args);
  };
  const jump = async (ref: SourceRef) => {
    jumpRequest.current?.abort();
    const abort = new AbortController();
    jumpRequest.current = abort;
    try {
      const found = await api(
        `/api/mindmaps/source?${new URLSearchParams({ domain: ref.domain, targetId: ref.targetId })}`,
        { signal: abort.signal },
      );
      const block = found.source.blocks.find(
        (b: { blockId: string }) => b.blockId === ref.blockId,
      );
      if (!block)
        throw new Error("原文内容块已删除或身份不确定，请在属性面板重新关联");
      const url = `${found.source.url}#block-${ref.blockId}`;
      if (await reuseSourceWindow(ref, url, abort.signal)) return;
      if (abort.signal.aborted) return;
      if (
        window.opener &&
        !window.opener.closed &&
        window.opener.location.origin === location.origin
      ) {
        window.opener.location.href = url;
        window.opener.focus();
      } else window.open(url, `mindmap-source-${ref.domain}-${ref.targetId}`);
    } catch (e) {
      if (abort.signal.aborted) return;
      setError((e as Error).message);
      setProperties(true);
    }
  };
  const clearDrop = () => {
    dropNode.current?.group?.node.classList.remove("map-drop-parent");
    dropNode.current = null;
    setDropHint("");
  };
  const dropTarget = (x: number, y: number): Node | null => {
    // Use viewport rectangles: SVG text, links and overlays are not reliable event targets.
    return (
      Object.values(engine.current?.renderer.nodeCache ?? {})
        .filter((node) => {
          const group = node.group?.node;
          if (!group?.isConnected) return false;
          const r = group.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            x >= r.left &&
            x <= r.right &&
            y >= r.top &&
            y <= r.bottom
          );
        })
        .sort((a, b) => {
          const area = (node: Node) => {
            const r = node.group!.node.getBoundingClientRect();
            return r.width * r.height;
          };
          return area(a) - area(b);
        })[0] ?? null
    );
  };
  const addReference = (value: unknown, parent?: Node | null) => {
    try {
      if (!map?.canEdit || conflict || !map.source || !engine.current)
        throw new Error("当前导图不可编辑");
      const drop = value as {
        version: number;
        source: SourceTarget;
        blockId: string;
        fingerprint: string;
        quote?: string;
        text?: string;
      };
      if (drop.version !== 1 || !sameSource(drop.source, map.source))
        throw new Error("仅支持当前关联文章的卡片或选区");
      const block = map.source.blocks.find(
        (block) =>
          block.blockId === drop.blockId &&
          block.fingerprint === drop.fingerprint,
      );
      if (
        !block ||
        (drop.quote &&
          !block.text.includes(drop.quote) &&
          !block.markdown.includes(drop.quote))
      )
        throw new Error("原文已变化，请重新选择引用");
      const ref: SourceRef = {
        ...drop.source,
        blockId: block.blockId,
        fingerprint: block.fingerprint,
        quote: drop.quote || block.text.slice(0, 500),
      };
      const target =
        parent ??
        engine.current.renderer.nodeCache[
          engine.current.getData(true).root!.data.uid as string
        ];
      if (!target?.group?.node.isConnected)
        throw new Error("目标节点已变化，请选择节点后重试添加");
      command("INSERT_CHILD_NODE", false, [target], {
        text: drop.text || block.title,
        sourceRef: ref,
        uid: crypto.randomUUID(),
      });
      setPendingDrop(null);
      setError("");
    } catch (e) {
      setPendingDrop(value);
      setError((e as Error).message);
    }
  };
  const generate = async () => {
    setCandidate(null);
    setAiRecheck(false);
    setAiOpen(true);
    setAiBusy(true);
    setAiProgress("准备文章…");
    setError("");
    try {
      if (map?.source && !(await flushSourceWindows(map.source)))
        throw new Error("原文章尚未保存，请先解决保存问题");
      if (!(await flush(true))) throw new Error("请先保存导图并处理版本冲突");
      const latest = (await api(`/api/mindmaps/${map!.id}`)).map as MapPayload;
      if (!latest.source) throw new Error("当前导图没有关联文章");
      setMap(latest);
      const baseline = sequence.current;
      const abort = new AbortController();
      cancelAi.current = abort;
      const response = await fetch("/api/ai/mindmaps", {
        method: "POST",
        ...sendJson({
          mapId: map!.id,
          revision: queue.current!.revision,
          version: queue.current!.version,
          contentHash: latest.source.contentHash,
        }),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        received = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, end).replace(/^data: /, ""));
          buffer = buffer.slice(end + 2);
          if (event.type === "progress")
            setAiProgress(
              event.phase === "structure" || event.phase === "merge"
                ? event.range
                : `整理 ${event.current}/${event.total} · ${event.range}`,
            );
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "candidate") {
            setCandidate({ ...event, editSequence: baseline });
            received = true;
            setAiProgress(
              `生成完成 · 已按全文 ${event.headingCount ?? 0} 个标题归位${event.mergedDuplicates ? ` · 合并 ${event.mergedDuplicates} 个重复节点` : ""}${event.supplementedCards ? ` · 已从原文补齐 ${event.supplementedCards} 张引用卡片` : ""} · 请预览后加入`,
            );
          }
        }
      }
      if (!received) throw new Error("未收到完整候选导图，请重试");
    } catch (e) {
      setAiProgress(
        (e as Error).name === "AbortError"
          ? "已取消，可重新生成"
          : (e as Error).message,
      );
    } finally {
      setAiBusy(false);
    }
  };
  const apply = async (recheck = false, replace = false) => {
    if (!candidate || !map) return;
    try {
      if (!(await flush(true))) throw new Error("导图尚未保存，请先处理冲突");
      const remote = (await api(`/api/mindmaps/${map.id}`)).map as MapPayload;
      if (!remote.source || remote.source.contentHash !== candidate.contentHash)
        throw new Error("文章在生成期间发生变化，候选已保留，请重新生成");
      if (
        remote.revision !== queue.current!.revision ||
        remote.version !== queue.current!.version
      )
        throw new Error("另一窗口更新了导图，请先处理冲突");
      if (
        !recheck &&
        (queue.current!.revision !== candidate.revision ||
          queue.current!.version !== candidate.mapVersion ||
          sequence.current !== candidate.editSequence)
      ) {
        setAiRecheck(true);
        throw new Error("导图在预览期间已变化，请核对后再追加或替换");
      }
      const root =
        engine.current!.renderer.nodeCache[
          engine.current!.getData(true).root!.data.uid as string
        ];
      const children = candidate.branch.children ?? [];
      const empty = !engine.current!.getData(true).root?.children?.length;
      fitOnRender.current?.();
      // A single insert command creates one undo history entry.
      if (replace && !empty) {
        const previous = engine.current!.getData(true) as MapDocument;
        download(previous, `${map.title}-AI替换前备份.json`);
        engine.current!.updateData({
          ...structuredClone(previous.root),
          children: structuredClone(children),
        });
        setSelected(null);
      } else if (empty) command("INSERT_MULTI_CHILD_NODE", [root], children);
      else
        command(
          "INSERT_CHILD_NODE",
          false,
          [root],
          candidate.branch.data,
          candidate.branch.children,
        );
      setCandidate(null);
      setAiRecheck(false);
      setAiOpen(false);
    } catch (e) {
      setAiProgress((e as Error).message);
    }
  };
  const expandFromMenu = (expand: boolean, wholeMap = false) => {
    if (!engine.current || conflict) return;
    const uid = wholeMap ? "" : contextMenu?.node?.getData().uid || "";
    fitOnRender.current?.();
    if (expand) engine.current.execCommand("EXPAND_ALL", uid);
    else engine.current.execCommand("UNEXPAND_ALL", false, uid);
    setContextMenu(null);
    canvas.current?.focus();
  };
  const importJson = async (file?: File) => {
    try {
      if (conflict)
        throw new Error("请先导出或另存冲突副本，并重新读取服务器版本后导入");
      if (!file || !engine.current || !map?.canEdit) return;
      const data = validateMapDocument(JSON.parse(await file.text()));
      download(engine.current.getData(true), `${map.title}-导入前备份.json`);
      engine.current.setFullData(data);
      setMap((m) => (m ? { ...m, data } : m));
      queue.current!.enqueue(
        engine.current.getData(true) as MapDocument,
        map.title,
      );
      await flush();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveCopy = async () => {
    try {
      const draft = queue.current?.pending ?? localDraft;
      if (!draft) return;
      const result = await api("/api/mindmaps", {
        method: "POST",
        ...sendJson({ title: `${draft.title} · 冲突副本`, data: draft.data }),
      });
      download(draft.data, `${draft.title}-冲突备份.json`);
      setStatus("已另存副本，原图的本地草稿仍保留");
      window.open(`/mindmaps?id=${result.map.id}`, "_blank");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const preview = (node: MapNode): React.ReactNode => (
    <li key={node.data.uid || node.data.text}>
      {node.data.text}
      {node.data.sourceRef && <span className="map-source-label"> 原文 ↗</span>}
      {node.children?.length ? <ul>{node.children.map(preview)}</ul> : null}
    </li>
  );
  const exportMap = async (type: "png" | "svg" | "md" | "json") => {
    try {
      if (!map || !engine.current) return;
      await api(`/api/mindmaps/${map.id}`);
      captureDraft.current?.();
      await markdown.current?.ready();
      if (type === "png" || type === "svg")
        await prepareMarkdownExport(canvas.current!);
      if (type === "json")
        download(engine.current.getData(true), `${map.title}.json`);
      else await engine.current.export(type, true, map.title);
    } catch (error) {
      setError(error instanceof Error ? error.message : "导出失败，请重试");
    }
  };
  return (
    <main className="article-mindmap">
      <header className="map-header">
        <a
          href={map?.source?.url || "/admin/mindmaps"}
          target="_blank"
          rel="opener"
        >
          {map?.source ? "原文 ↗" : "导图列表"}
        </a>
        <strong>{map?.title || "文章思维导图"}</strong>
        <span role="status" className="map-save-status">
          {status}
        </span>
        {map?.canAi && map.source && (
          <button className="map-accent" onClick={() => void generate()}>
            AI 生成
          </button>
        )}
        <details className="map-menu">
          <summary>导出 ▾</summary>
          <div>
            {["png", "svg", "md"].map((type) => (
              <button
                key={type}
                onClick={() => void exportMap(type as "png" | "svg" | "md")}
              >
                {type.toUpperCase()}
              </button>
            ))}
            <button onClick={() => void exportMap("json")}>JSON 备份</button>
            {map?.canEdit && (
              <label>
                导入 JSON
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => void importJson(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
        </details>
      </header>
      <nav className="map-tools" aria-label="导图工具">
        <button
          disabled={!map?.canEdit || conflict}
          onClick={() => command("BACK")}
        >
          撤销
        </button>
        <button
          disabled={!map?.canEdit || conflict}
          onClick={() => command("FORWARD")}
        >
          重做
        </button>
        <details className="map-menu">
          <summary>插入 ▾</summary>
          <div>
            {[
              ["同级主题", "INSERT_NODE"],
              ["子主题", "INSERT_CHILD_NODE"],
              ["父主题", "INSERT_PARENT_NODE"],
              ["边界", "ADD_OUTER_FRAME"],
              ["概要", "ADD_GENERALIZATION"],
            ].map(([label, action]) => (
              <button
                key={action}
                disabled={!map?.canEdit || conflict}
                onClick={() => command(action!)}
              >
                {label}
              </button>
            ))}
            <button
              disabled={!map?.canEdit || conflict}
              onClick={() =>
                engine.current?.associativeLine.createLineFromActiveNode()
              }
            >
              关系线
            </button>
          </div>
        </details>
        <select
          aria-label="布局"
          disabled={!map?.canEdit || conflict}
          value={map?.data.layout || "mindMap"}
          onChange={(e) => {
            engine.current?.setLayout(e.target.value);
            setMap((m) =>
              m ? { ...m, data: { ...m.data, layout: e.target.value } } : m,
            );
          }}
        >
          {[
            ["mindMap", "思维导图"],
            ["logicalStructure", "逻辑图"],
            ["catalogOrganization", "树形图"],
            ["organizationStructure", "组织结构图"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="map-search map-desktop-only">
          <input
            placeholder="搜索节点"
            aria-label="搜索节点"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              e.target.value
                ? engine.current?.search.search(e.target.value)
                : engine.current?.search.endSearch();
            }}
          />
        </div>
        <button
          className="map-desktop-only"
          onClick={() => setProperties(!properties)}
        >
          属性
        </button>
        <button className="map-desktop-only" onClick={() => setHelp(!help)}>
          帮助
        </button>
        <button
          onClick={() => {
            writeState({
              ...readState(),
              mode: document.documentElement.classList.contains("dark")
                ? "light"
                : "dark",
            });
          }}
        >
          明暗
        </button>
        <details className="map-menu map-mobile-tools">
          <summary>更多 ▾</summary>
          <div>
            <div className="map-search">
              <input
                placeholder="搜索节点"
                aria-label="搜索节点"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  e.target.value
                    ? engine.current?.search.search(e.target.value)
                    : engine.current?.search.endSearch();
                }}
              />
            </div>
            <button onClick={() => setProperties(!properties)}>属性</button>
            <button onClick={() => setHelp(!help)}>帮助</button>
            {map?.canEdit && (
              <button onClick={() => void flush(true)}>保存</button>
            )}
          </div>
        </details>
        {map?.canEdit && (
          <button className="map-desktop-only" onClick={() => void flush(true)}>
            保存
          </button>
        )}
      </nav>
      {error && (
        <div role="alert" className="map-alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
          {!map && <button onClick={() => void load()}>重试</button>}
          {choices.map((choice) => (
            <button key={choice.id} onClick={() => void load(choice.id)}>
              选主图：{choice.title}
            </button>
          ))}
          {pendingDrop !== null && (
            <button onClick={() => addReference(pendingDrop, selected)}>
              重试待添加内容
            </button>
          )}
        </div>
      )}
      {conflict && (
        <div className="map-alert" role="alert">
          版本冲突：本地修改已暂存，当前服务器版本不会被覆盖。
          <button
            onClick={() =>
              download(
                queue.current?.pending?.data ?? localDraft?.data,
                "导图本地修改.json",
              )
            }
          >
            导出本地修改
          </button>
          <button onClick={() => void saveCopy()}>另存独立副本</button>
          <button
            onClick={() => {
              if (localDraft || queue.current?.pending)
                download(
                  queue.current?.pending?.data ?? localDraft?.data,
                  "导图冲突备份.json",
                );
              localStorage.removeItem(draftKey.current);
              if (queue.current) queue.current.pending = null;
              location.reload();
            }}
          >
            备份并重读服务器
          </button>
        </div>
      )}
      {recoveries.length > 0 && (
        <div className="map-alert">
          发现 {recoveries.length} 份其他窗口的暂存草稿。可导出后通过 JSON
          导入恢复。
          {recoveries.map((draft, index) => (
            <button
              key={index}
              onClick={() =>
                download(
                  draft.data,
                  `${draft.title}-暂存草稿-${index + 1}.json`,
                )
              }
            >
              导出草稿 {index + 1}
            </button>
          ))}
        </div>
      )}
      {broken.length > 0 && (
        <div className="map-alert">
          {broken.length} 个引用待修复：{broken.slice(0, 3).join("、")}
          <button onClick={() => setProperties(true)}>查看属性</button>
        </div>
      )}
      <div className="map-body">
        <div
          className="map-canvas"
          ref={canvas}
          tabIndex={0}
          aria-label="思维导图画布"
          onMouseDownCapture={(event) => {
            // Controls are not node drags. In particular, ending inline editing
            // on mousedown replaces the expand button before the browser can
            // dispatch click. Let its click handler finish editing instead.
            if ((event.target as Element)?.closest(
              '.smm-expand-btn,[data-source-jump],.map-node-markdown :is(a,button,input,select,textarea,summary)',
            )) event.stopPropagation();
          }}
          onPointerDownCapture={(event) => {
            const target = event.target;
            if (!(target instanceof Element) || !target.closest('.smm-node') ||
                target.closest('a,button,input,select,textarea,summary,[contenteditable="true"],[data-source-jump],.smm-expand-btn')) return;
            // An already active node and its resize handles skip node activation.
            // Capture before their handlers stop propagation and finish editing.
            engine.current?.renderer.textEdit.hideEditTextBox();
            event.currentTarget.focus({ preventScroll: true });
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            const node = dropTarget(event.clientX, event.clientY);
            if (node) {
              setSelected(node);
              setName(node.getData().text);
              setNote(String(node.getData().note ?? ""));
            }
            setContextMenu({
              x: Math.max(8, Math.min(event.clientX, window.innerWidth - 228)),
              y: Math.max(8, Math.min(event.clientY, window.innerHeight - 230)),
              node,
            });
          }}
          onDragOver={(e) => {
            if (acceptsMapDrag(e.dataTransfer) && map?.canEdit && !conflict) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const node = dropTarget(e.clientX, e.clientY);
              if (dropNode.current !== node) {
                dropNode.current?.group?.node.classList.remove(
                  "map-drop-parent",
                );
                dropNode.current = node;
                node?.group?.node.classList.add("map-drop-parent");
              }
              setDropHint(
                `松开，将卡片加入「${(node?.getData().text || map.title).slice(0, 30)}」下`,
              );
            }
          }}
          onDragLeave={(e) => {
            if (
              e.relatedTarget instanceof globalThis.Node &&
              e.currentTarget.contains(e.relatedTarget)
            )
              return;
            clearDrop();
          }}
          onDragEnd={clearDrop}
          onDrop={(e) => {
            e.preventDefault();
            const target = dropTarget(e.clientX, e.clientY);
            clearDrop();
            try {
              addReference(readMapDrag(e.dataTransfer), target);
            } catch (error) {
              setError(
                error instanceof SyntaxError
                  ? "拖拽数据不完整，请重新选择卡片"
                  : (error as Error).message,
              );
            }
          }}
        />
        {dropHint && (
          <div className="map-drop-hint" role="status">
            {dropHint}
          </div>
        )}
        {properties && (
          <aside className="map-properties" key={selected?.getData().uid}>
            <h2>节点属性</h2>
            {selected ? (
              <>
                <label>
                  名称 · Markdown 源码
                  <textarea
                    aria-label="名称"
                    rows={5}
                    disabled={!map?.canEdit || conflict}
                    value={name}
                    onChange={(e) => {
                      propertyNameDraft.current = {
                        uid: selected.getData().uid!,
                        text: e.target.value,
                      };
                      setName(e.target.value);
                    }}
                    onBlur={() => {
                      propertyNameDraft.current = null;
                      command("SET_NODE_TEXT", selected, name);
                    }}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    disabled={!map?.canEdit || conflict}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => command("SET_NODE_NOTE", selected, note)}
                  />
                </label>
                <label>
                  节点填色
                  <input
                    type="color"
                    disabled={!map?.canEdit || conflict}
                    defaultValue={String(
                      selected.getStyle("fillColor") || "#fffaf1",
                    )}
                    onChange={(e) =>
                      command(
                        "SET_NODE_STYLE",
                        selected,
                        "fillColor",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  文字颜色
                  <input
                    type="color"
                    disabled={!map?.canEdit || conflict}
                    defaultValue={String(
                      selected.getStyle("color") || "#151511",
                    )}
                    onChange={(e) =>
                      command(
                        "SET_NODE_STYLE",
                        selected,
                        "color",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  描边颜色
                  <input
                    type="color"
                    disabled={!map?.canEdit || conflict}
                    defaultValue={String(
                      selected.getStyle("borderColor") || "#151511",
                    )}
                    onChange={(e) =>
                      command(
                        "SET_NODE_STYLE",
                        selected,
                        "borderColor",
                        e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  字号
                  <select
                    disabled={!map?.canEdit || conflict}
                    defaultValue={String(selected.getStyle("fontSize") || 15)}
                    onChange={(e) =>
                      command(
                        "SET_NODE_STYLE",
                        selected,
                        "fontSize",
                        Number(e.target.value),
                      )
                    }
                  >
                    {[12, 14, 15, 16, 20, 24, 32].map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  形状
                  <select
                    disabled={!map?.canEdit || conflict}
                    defaultValue={String(
                      selected.getStyle("shape") || "rectangle",
                    )}
                    onChange={(e) =>
                      command(
                        "SET_NODE_STYLE",
                        selected,
                        "shape",
                        e.target.value,
                      )
                    }
                  >
                    {[
                      ["rectangle", "矩形"],
                      ["roundedRectangle", "圆角矩形"],
                      ["ellipse", "椭圆"],
                      ["diamond", "菱形"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!map?.canEdit || conflict}
                  onClick={() => command("REMOVE_NODE", selected)}
                >
                  删除主题
                </button>
                <h3>原文来源</h3>
                <p>{selected.getData().sourceRef?.quote || "没有关联引用"}</p>
                {selected.getData().sourceRef && (
                  <button
                    onClick={() => void jump(selected.getData().sourceRef!)}
                  >
                    定位原文 ↗
                  </button>
                )}
                {map?.source && map.canEdit && (
                  <label>
                    重新关联
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const block = map.source!.blocks.find(
                          (b) => b.blockId === e.target.value,
                        );
                        if (block)
                          command("SET_NODE_DATA", selected, {
                            sourceRef: {
                              domain: map.source!.domain,
                              targetId: map.source!.targetId,
                              blockId: block.blockId,
                              fingerprint: block.fingerprint,
                              quote: block.text.slice(0, 500),
                            },
                            referenceNeedsRepair: false,
                          });
                      }}
                    >
                      <option value="">选择当前文章内容块</option>
                      {map.source.blocks.map((block) => (
                        <option key={block.blockId} value={block.blockId}>
                          {block.kind} · {block.title.slice(0, 50)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <p>单击主题查看名称、备注与来源。</p>
            )}
            <button onClick={() => setProperties(false)}>收起属性</button>
          </aside>
        )}
      </div>
      {editingName && (
        <div
          className="map-dialog-backdrop"
          data-map-modal
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <section
            className="map-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="编辑节点名称"
          >
            <h2>编辑节点名称</h2>
            <p>
              支持 Markdown、公式及博客扩展语法。Ctrl+Enter 保存，Esc 取消。
            </p>
            <textarea
              className="map-name-source"
              aria-label="节点名称源码"
              autoFocus
              rows={10}
              value={editingName.text}
              onChange={(event) => {
                const draft = { ...editingName, text: event.target.value };
                nameDraft.current = draft;
                setEditingName(draft);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  finishName(false);
                }
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  finishName();
                }
              }}
            />
            <div className="map-dialog-actions">
              <button onClick={() => finishName(false)}>取消</button>
              <button className="map-accent" onClick={() => finishName()}>
                保存名称
              </button>
            </div>
          </section>
        </div>
      )}
      {contextMenu && (
        <div
          ref={menuElement}
          className="map-context-menu"
          role="menu"
          aria-label="节点展开与折叠菜单"
          data-map-modal
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            );
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            items[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length
            ]?.focus();
          }}
        >
          <span>{contextMenu.node?.getData().text || "整张思维导图"}</span>
          {contextMenu.node && (
            <button
              role="menuitem"
              disabled={!map?.canEdit || conflict}
              onClick={() => {
                const node = contextMenu.node!;
                setContextMenu(null);
                editName(node);
              }}
            >
              编辑节点
            </button>
          )}
          <button
            role="menuitem"
            disabled={conflict}
            onClick={() => expandFromMenu(true)}
          >
            展开所有
          </button>
          <button
            role="menuitem"
            disabled={conflict}
            onClick={() => expandFromMenu(false)}
          >
            折叠所有
          </button>
          {contextMenu.node && (
            <>
              <button
                role="menuitem"
                disabled={conflict}
                onClick={() => expandFromMenu(true, true)}
              >
                展开整张图
              </button>
              <button
                role="menuitem"
                disabled={conflict}
                onClick={() => expandFromMenu(false, true)}
              >
                折叠整张图
              </button>
            </>
          )}
        </div>
      )}
      <footer className="map-footer">
        <span>
          {selected
            ? `当前选中：${selected.getData().text}`
            : "拖入当前文章的卡片，或用 Tab 新建主题"}
        </span>
        <button onClick={() => engine.current?.view.narrow()}>−</button>
        <span>{zoom}%</span>
        <button onClick={() => engine.current?.view.enlarge()}>＋</button>
        <button onClick={() => engine.current?.view.fit()}>适应</button>
      </footer>
      {help && (
        <div className="map-dialog-backdrop" data-map-modal>
          <section
            className="map-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="操作帮助"
          >
            <h2>常用快捷键</h2>
            <p>
              Enter 同级 · Tab 子主题 · Ctrl+Enter 父主题 · 空格 / F2 改名 · Delete
              删除
            </p>
            <p>
              Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Ctrl+/ 折叠当前 · Ctrl+Alt+/
              折叠全部
            </p>
            <p>Ctrl+Shift+R 关系线 · Ctrl+B 边界 · Ctrl+S 保存</p>
            <p>
              单击选中；右侧 ↗
              定位原文。Ctrl+滚轮缩放，滚轮或拖动画布平移，框选和方向键切换主题。
            </p>
            <button onClick={() => setHelp(false)}>关闭</button>
          </section>
        </div>
      )}
      {aiOpen && (
        <div className="map-dialog-backdrop" data-map-modal>
          <section
            className="map-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="AI 生成预览"
          >
            <h2>AI 生成</h2>
            <p>当前文章 · 使用博客已配置的文字模型</p>
            <p role="status">{aiProgress}</p>
            {candidate && (
              <ul className="map-ai-preview">{preview(candidate.branch)}</ul>
            )}
            <div className="map-dialog-actions">
              <button
                onClick={() => {
                  cancelAi.current?.abort();
                  setAiOpen(false);
                }}
              >
                取消
              </button>
              <button disabled={aiBusy} onClick={() => void generate()}>
                重新生成
              </button>
              {candidate && (
                <>
                  <button
                    disabled={aiBusy}
                    className="map-accent"
                    onClick={() => void apply()}
                  >
                    作为新分支加入
                  </button>
                  {aiRecheck && (
                    <button disabled={aiBusy} onClick={() => void apply(true)}>
                      核对后追加
                    </button>
                  )}
                  {!!engine.current?.getData(true).root?.children?.length && (
                    <button
                      disabled={aiBusy}
                      onClick={() => void apply(aiRecheck, true)}
                    >
                      {aiRecheck
                        ? "核对后替换（备份）"
                        : "替换当前导图（备份）"}
                    </button>
                  )}
                </>
              )}
              <a href="/admin/settings" target="_blank">
                AI 设置 ↗
              </a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
