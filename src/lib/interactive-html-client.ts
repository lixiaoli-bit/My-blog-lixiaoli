import type { InteractiveBlock } from './interactive-html';
import { prepareInteractiveDocument } from './interactive-html-document';
import '../styles/interactive-html.css';

type Payload = InteractiveBlock & { document: string; warnings: string[] };
const instances = new Map<HTMLElement, InteractiveInstance>();
export class InteractiveInstance {
  private frame: HTMLIFrameElement | null = null;
  private token = '';
  private timeout = 0;
  private observer: IntersectionObserver;
  private events = new AbortController();
  private loads = 0;
  private messages = 0;
  private windowStart = 0;
  private ready = false;
  private previousFocus: HTMLElement | null = null;
  constructor(public root: HTMLElement, private payload: Payload, private manual: boolean) {
    root.dataset.interactiveBound = 'true';
    const signal = this.events.signal;
    root.addEventListener('click', event => {
      const target = (event.target as Element)?.closest<HTMLElement>('[data-interactive-action]');
      if (!target || !root.contains(target)) return;
      event.preventDefault(); event.stopPropagation();
      if (target.dataset.interactiveAction === 'run') this.run();
      if (target.dataset.interactiveAction === 'expand') this.expand(root.dataset.expanded !== 'true');
      if (target.dataset.interactiveAction === 'source') {
        const details = root.querySelector<HTMLDetailsElement>('[data-interactive-source-view]')!;
        details.hidden = !details.hidden; details.open = !details.hidden;
      }
    }, { signal });
    root.addEventListener('pointerdown', event => event.stopPropagation(), { signal });
    root.addEventListener('mousedown', event => event.stopPropagation(), { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root.dataset.expanded === 'true') { event.preventDefault(); this.expand(false); }
    }, { signal });
    window.addEventListener('message', this.message, { signal });
    this.observer = new IntersectionObserver(entries => {
      const visible = entries[0]?.isIntersecting && this.visible();
      if (visible && !this.manual && !this.frame && !this.payload.error && root.dataset.interactiveState !== 'error') this.run();
      this.send('visibility', !!visible);
    });
    this.observer.observe(root);
  }
  visible() {
    return !this.root.closest('[hidden],details:not([open])') && this.root.getClientRects().length > 0;
  }
  updateVisibility() {
    if (this.visible()) {
      const rect = this.root.getBoundingClientRect();
      if (!this.manual && !this.frame && !this.payload.error && this.root.dataset.interactiveState !== 'error' && rect.bottom > 0 && rect.top < innerHeight) this.run();
      this.send('measure', null);
    }
    this.send('visibility', this.visible()); this.sendTheme();
  }
  private status(value: string) { const label = this.root.querySelector('[data-interactive-status]'); if (label) label.textContent = value; }
  private info(value: string) {
    const details = this.root.querySelector<HTMLDetailsElement>('[data-interactive-errors]')!;
    const text = details.querySelector('pre')!;
    if ((text.textContent?.length || 0) < 12000) text.textContent += `${text.textContent ? '\n' : ''}${value.slice(0, 1200)}`;
    details.hidden = false; this.status('运行有提示 · 查看运行信息');
  }
  private fail(value: string) {
    window.clearTimeout(this.timeout); this.frame?.remove(); this.frame = null;
    this.root.dataset.interactiveState = 'error'; this.status('运行失败'); this.info(value);
  }
  run() {
    if (this.payload.error) return;
    window.clearTimeout(this.timeout); this.frame?.remove(); this.ready = false; this.loads = 0;
    this.token = `byqx-html-${crypto.randomUUID()}`;
    const frame = document.createElement('iframe');
    this.frame = frame;
    frame.name = this.token; frame.title = this.payload.title;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.style.height = `${this.payload.initialHeight}px`;
    frame.addEventListener('load', () => { if (this.frame === frame && ++this.loads > 1) this.fail('页面发生了自导航，已停止演示；请使用页面内交互并重新运行'); }, { signal: this.events.signal });
    frame.srcdoc = this.payload.document;
    this.root.querySelector('[data-interactive-stage]')!.replaceChildren(frame);
    this.root.dataset.interactiveState = 'running'; this.status('启动中…');
    this.root.querySelector<HTMLElement>('[data-interactive-action=run]')!.textContent = '重新运行';
    this.timeout = window.setTimeout(() => { if (!this.ready) this.fail('页面未能启动；请检查脚本、资源和浏览器内容策略'); }, 8000);
  }
  private send(type: string, value: unknown) { this.frame?.contentWindow?.postMessage({ token: this.token, type, value }, '*'); }
  private sendTheme() { this.send('theme', document.documentElement.classList.contains('dark') || document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'); }
  private message = (event: MessageEvent) => {
    if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (!data || data.channel !== 'byqx-interactive' || data.token !== this.token) return;
    if (Date.now() - this.windowStart > 1000) { this.windowStart = Date.now(); this.messages = 0; }
    if (++this.messages > 30) return;
    if (data.type === 'ready') { this.ready = true; window.clearTimeout(this.timeout); this.status('运行中'); this.sendTheme(); }
    else if (data.type === 'height' && Number.isFinite(data.value)) {
      const height = Math.min(960, Math.max(200, Math.ceil(data.value)));
      (this.root.querySelector('[data-interactive-stage]') as HTMLElement).style.minHeight = '0';
      if (Math.abs(parseFloat(this.frame.style.height) - height) > 2) this.frame.style.height = `${height}px`;
    } else if (data.type === 'error' && typeof data.value === 'string' && data.value.length <= 1200) this.info(data.value);
    else if (data.type === 'navigation') this.fail('页面尝试自导航，已停止演示；请重新运行');
    else if (data.type === 'escape') {
      if (this.root.dataset.expanded === 'true') this.expand(false);
      else this.root.closest<HTMLDialogElement>('dialog[data-interactive-dialog]')?.close();
    }
  };
  expand(value: boolean) {
    if (value) { this.previousFocus = document.activeElement as HTMLElement; this.root.dataset.expanded = 'true'; }
    else { delete this.root.dataset.expanded; this.previousFocus?.focus({ preventScroll: true }); }
    const button = this.root.querySelector<HTMLElement>('[data-interactive-action=expand]')!;
    button.textContent = value ? '还原' : '放大'; button.setAttribute('aria-expanded', String(value));
    if (value) { if (!this.frame) this.run(); button.focus(); }
    this.send('measure', null);
  }
  destroy() {
    window.clearTimeout(this.timeout); this.observer.disconnect(); this.events.abort(); this.frame?.remove();
    delete this.root.dataset.interactiveBound; instances.delete(this.root);
  }
}
export function mountInteractiveCard(root: HTMLElement, manual = false): InteractiveInstance | undefined {
  if (instances.has(root)) return instances.get(root);
  try {
    const template = root.querySelector<HTMLTemplateElement>('template[data-interactive-payload]');
    const payload = JSON.parse(template?.content.textContent || '') as Payload;
    if (typeof payload.source !== 'string' || typeof payload.document !== 'string') return;
    const instance = new InteractiveInstance(root, payload, manual); instances.set(root, instance); return instance;
  } catch { root.querySelector('[data-interactive-status]')?.replaceChildren('演示数据无法读取；源码已保留'); }
}
export function createInteractiveCard(block: InteractiveBlock): HTMLElement {
  const root = document.createElement('section'); root.className = 'interactive-html not-prose';
  root.dataset.interactiveCard = ''; root.dataset.interactiveId = block.key;
  let runDocument = '', warnings: string[] = [], error = block.error || '';
  if (!error) try { const prepared = prepareInteractiveDocument(block.source); runDocument = prepared.document; warnings = prepared.warnings; } catch (value) { error = (value as Error).message; }
  // Only trusted fixed markup goes through innerHTML. All user text is assigned below.
  root.innerHTML = '<header><strong></strong><span data-interactive-status role="status"></span></header><div class="interactive-html-actions"><button type="button" data-interactive-action="run">运行</button><button type="button" data-interactive-action="expand">放大</button><button type="button" data-interactive-action="source">查看源码</button></div><div data-interactive-stage></div><details data-interactive-errors><summary>运行信息</summary><pre></pre></details><details data-interactive-source-view hidden><summary>HTML 源码</summary><pre><code></code></pre></details><template data-interactive-payload></template>';
  root.querySelector('strong')!.textContent = block.title;
  root.querySelector('[data-interactive-status]')!.textContent = error || '等待运行';
  (root.querySelector('[data-interactive-stage]') as HTMLElement).style.minHeight = `${block.initialHeight}px`;
  root.querySelector('[data-interactive-source-view] code')!.textContent = block.source;
  const details = root.querySelector<HTMLDetailsElement>('[data-interactive-errors]')!;
  details.hidden = !error && !warnings.length; details.querySelector('pre')!.textContent = [error, ...warnings].filter(Boolean).join('\n');
  const template = root.querySelector<HTMLTemplateElement>('template')!;
  template.content.appendChild(root.ownerDocument.createTextNode(JSON.stringify({ ...block, error, document: runDocument, warnings })));
  if (error) root.querySelectorAll<HTMLButtonElement>('button:not([data-interactive-action=source])').forEach(button => button.disabled = true);
  return root;
}
export function openInteractivePreview(block: InteractiveBlock) {
  const focus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog'); dialog.dataset.interactiveDialog = ''; dialog.dataset.mapModal = '';
  dialog.style.cssText = 'width:min(1000px,96vw);max-height:94vh;padding:12px;background:var(--background,#fbf7ee);color:var(--foreground,#222);border:2px solid currentColor;overflow:auto';
  const close = document.createElement('button'); close.textContent = '关闭演示'; close.type = 'button'; close.onclick = () => dialog.close();
  const card = createInteractiveCard(block); dialog.append(close, card); document.body.append(dialog); dialog.showModal();
  const instance = mountInteractiveCard(card, true); instance?.run();
  dialog.addEventListener('close', () => { instance?.destroy(); dialog.remove(); focus?.focus({ preventScroll: true }); }, { once: true });
  return dialog;
}
let observer: MutationObserver | null = null;
let scheduled = false;
export function initInteractiveHtml() {
  const scan = () => {
    scheduled = false;
    for (const [root, instance] of instances) if (!root.isConnected) instance.destroy();
    document.querySelectorAll<HTMLElement>('[data-interactive-card]').forEach(root => {
      if (root.closest('.map-node-markdown') || root.closest('svg')) return;
      const manual = !!root.closest('.cm-editor,[data-interactive-manual],#doc-node-preview,[data-m3-module="article-editor"]');
      mountInteractiveCard(root, manual)?.updateVisibility();
    });
  };
  if (!observer) {
    observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden','open','class','data-mode'] });
    document.addEventListener('astro:before-swap', () => { for (const instance of [...instances.values()]) instance.destroy(); document.querySelectorAll('dialog[data-interactive-dialog]').forEach(dialog => dialog.remove()); });
  }
  scan();
}
