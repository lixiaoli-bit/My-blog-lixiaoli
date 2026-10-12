import { EditorState, StateField, Transaction as EditorTransaction } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { scanMarkdownCallouts, quotedMarkdownSegments, quotePrefix } from '../../lib/markdown-callouts';
import type { MarkdownCallout } from '../../lib/markdown-callouts';
import { CALLOUT_LABELS, CALLOUT_TYPES } from '../../lib/markdown-format-catalog';
import type { CalloutType } from '../../lib/markdown-format-catalog';
import { visualBlocks } from './cm-visual-directives-state';
import { columnBlocks, columnTarget, registerEditorOwner, setColumnTarget } from './cm-columns-state';
import { headingFolding } from './cm-heading-folding';
import { blockWidgetContent, blockWidgetIdentities, blockWidgetLayout, blockWidgetResized, destroyBlockWidget, minimalTextChange, ownedBlockHistory, OwnedBlockWidget, ownsBlockWidget, syncBlockChild, wrapBlockWidget } from './cm-block-widget';
import type { BlockWidgetIdentity } from './cm-block-widget';

interface Options {
  foldHeadings?: boolean;
  childExtensions: () => Extension;
  onSave: () => void;
  onPaste: (event: ClipboardEvent) => boolean;
  onContextMenu: (event: MouseEvent, child: EditorView, parent: EditorView) => boolean;
}
const controllers = new WeakMap<HTMLElement, CalloutController>();
const aliases: Record<string, CalloutType> = { abstract: 'note', summary: 'note', todo: 'info', hint: 'tip', important: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question', caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };

/** Project only the changed body span; untouched quote prefixes remain byte-for-byte intact. */
function bodyChange(block: MarkdownCallout, body: string) {
  const change = minimalTextChange(block.body, body);
  if (!change) return null;
  if (!block.raw.includes('\n')) return { from: block.to, to: block.to, insert: '\n> ' + body.replaceAll('\n', '\n> ') };
  const segment = quotedMarkdownSegments(block.raw)[0]!;
  const start = segment.source.indexOf('\n') + 1;
  const from = segment.originalOffset(start + change.from), to = segment.originalOffset(start + change.to);
  const lineStart = block.raw.lastIndexOf('\n', from - 1) + 1, prefix = quotePrefix(block.raw.slice(lineStart))!;
  const first = change.insert[0] ?? block.body[change.to] ?? '';
  // A bare '>' would consume the first authored space as its optional separator.
  // Add that separator only on the edited line, preserving nested indentation.
  const separator = from === lineStart + prefix.length && prefix.endsWith('>') && /^[ \t]/.test(first) ? ' ' : '';
  return { from: block.from + from, to: block.from + to, insert: separator + change.insert.replaceAll('\n', '\n> ') };
}
function bodyOffset(raw: string, offset: number): number {
  if (!raw.includes('\n')) return raw.length;
  const segment = quotedMarkdownSegments(raw)[0]!;
  return segment.originalOffset(segment.source.indexOf('\n') + 1 + offset);
}

/** The body owns an ordinary Markdown editor; only the parent persists quote prefixes. */
class CalloutController {
  child: EditorView;
  syncing = false;
  disposed = false;
  private title = document.createElement('input');
  private type = document.createElement('select');
  private fold = document.createElement('button');
  private host = document.createElement('div');
  constructor(readonly parent: EditorView, readonly dom: HTMLElement, public block: MarkdownCallout, readonly options: Options, identity: BlockWidgetIdentity) {
    dom.contentEditable = 'false';
    dom.setAttribute('role', 'group');
    dom.setAttribute('aria-label', 'Callout 引用编辑');
    const head = document.createElement('div'); head.className = 'callout-title';
    this.type.setAttribute('aria-label', 'Callout 类型');
    for (const value of CALLOUT_TYPES) {
      const option = document.createElement('option'); option.value = value; option.textContent = CALLOUT_LABELS[value]; this.type.append(option);
    }
    this.title.setAttribute('aria-label', 'Callout 标题');
    this.title.addEventListener('input', () => this.commitHeading());
    this.type.addEventListener('change', () => this.commitHeading());
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.host.hidden = !this.host.hidden;
      this.updateFold();
    });
    head.append(this.type, this.title, this.fold);
    this.host.className = 'callout-body';
    dom.append(head, this.host);
    this.host.hidden = block.fold === '-';
    this.presentation();
    this.child = new EditorView({ parent: this.host, state: EditorState.create({ doc: block.body, extensions: [
      EditorView.lineWrapping, drawSelection(), markdown(), options.childExtensions(), placeholder('在引用中写 Markdown…'),
      ...(options.foldHeadings ? [headingFolding()] : []),
      keymap.of([
        { key: 'Mod-z', run: () => ownedBlockHistory(parent, false), shift: () => ownedBlockHistory(parent, true) },
        { key: 'Mod-Shift-z', run: () => ownedBlockHistory(parent, true) },
        { key: 'Mod-y', run: () => ownedBlockHistory(parent, true) },
        { key: 'Mod-s', run: () => { options.onSave(); return true; } },
        ...defaultKeymap, ...searchKeymap,
      ]),
      EditorView.domEventHandlers({
        contextmenu: (event) => options.onContextMenu(event, this.child, parent),
        focus: (event) => { if (event.target === this.child.contentDOM) { setColumnTarget(parent, this.child); setColumnTarget(this.child); } return false; },
        paste: (event) => { setColumnTarget(parent, this.child); return options.onPaste(event); },
      }),
      EditorView.updateListener.of(update => {
        if (!this.syncing && !this.disposed && update.docChanged && this.current()) {
          const changes = bodyChange(this.block, update.state.doc.toString());
          if (changes) {
            const raw = this.block.raw.slice(0, changes.from - this.block.from) + changes.insert + this.block.raw.slice(changes.to - this.block.from);
            const selection = update.state.selection.main;
            this.parent.dispatch({ changes, selection: { anchor: this.block.from + bodyOffset(raw, selection.anchor), head: this.block.from + bodyOffset(raw, selection.head) }, userEvent: 'input.type' });
          }
        } else if (!this.syncing && update.selectionSet && columnTarget(this.child)?.hasFocus && this.current()) {
          const selection = update.state.selection.main;
          this.parent.dispatch({ selection: { anchor: this.block.from + bodyOffset(this.block.raw, selection.anchor), head: this.block.from + bodyOffset(this.block.raw, selection.head) }, annotations: EditorTransaction.addToHistory.of(false) });
        }
      }),
      EditorView.theme({
        '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: 'inherit', minWidth: '0' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible' },
        '.cm-content': { padding: '8px 0', minHeight: '3rem' },
        '.cm-line': { padding: '0' },
      }),
    ] }) });
    registerEditorOwner(this.child, parent, () => {
      const block = this.block, source = parent.state.doc.toString();
      return body => { const change = bodyChange(block, body); return change ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source; };
    });
    const transferFocus = identity.focusOnMount;
    identity.focusOnMount = false;
    queueMicrotask(() => {
      // Virtualization also remounts existing widgets. That is not an instruction
      // to focus the title at the parent's old (possibly offscreen) selection.
      if (!transferFocus) return;
      if (this.disposed || !parent.hasFocus) return;
      const selection = parent.state.selection.main;
      if (selection.from < this.block.from || selection.to > this.block.to) return;
      if (selection.from <= this.block.from + this.block.heading.length) {
        this.title.focus(); this.title.select();
      } else {
        this.host.hidden = false; this.updateFold();
        this.child.focus(); setColumnTarget(parent, this.child);
      }
    });
  }
  private current(): boolean { return !this.disposed && this.parent.state.sliceDoc(this.block.from, this.block.to) === this.block.raw; }
  private commitHeading(): void {
    if (!this.current()) return;
    const heading = `> [!${this.type.value}]${this.block.fold} ${this.title.value.replace(/[\r\n]/g, '')}`;
    const changes = minimalTextChange(this.block.heading, heading, this.block.from);
    if (changes) this.parent.dispatch({ changes, userEvent: 'input.type' });
  }
  private updateFold(): void {
    this.fold.textContent = this.host.hidden ? '展开' : '收起';
    this.fold.setAttribute('aria-expanded', String(!this.host.hidden));
  }
  private presentation(): void {
    const type = aliases[this.block.type] ?? (CALLOUT_TYPES.includes(this.block.type as CalloutType) ? this.block.type as CalloutType : 'note');
    this.dom.className = `cm-callout-widget callout callout-${type}`;
    this.type.value = type;
    if (this.title.value !== this.block.title) this.title.value = this.block.title;
    this.title.placeholder = CALLOUT_LABELS[type];
    this.updateFold();
  }
  sync(block: MarkdownCallout): boolean {
    if (this.disposed) return false;
    this.block = block;
    this.presentation();
    syncBlockChild(this.child, () => this.block.body, () => this.disposed, value => this.syncing = value);
    return true;
  }
  destroy(): void { this.disposed = true; this.child.destroy(); }
}

class CalloutWidget extends OwnedBlockWidget {
  constructor(readonly block: MarkdownCallout, readonly options: Options, readonly layout: number, identity: BlockWidgetIdentity) { super(identity); }
  eq(other: CalloutWidget): boolean { return this.identity === other.identity && this.layout === other.layout && this.block.from === other.block.from && this.block.raw === other.block.raw; }
  toDOM(parent: EditorView): HTMLElement {
    const dom = document.createElement('div'); controllers.set(dom, new CalloutController(parent, dom, this.block, this.options, this.identity)); return wrapBlockWidget(dom, parent, '8px', this.identity);
  }
  updateDOM(dom: HTMLElement): boolean { return ownsBlockWidget(dom, this.identity) && (controllers.get(blockWidgetContent(dom))?.sync(this.block) ?? false); }
  ignoreEvent(): boolean { return true; }
  destroy(dom: HTMLElement): void { const card = blockWidgetContent(dom); destroyBlockWidget(dom); controllers.get(card)?.destroy(); controllers.delete(card); }
}

export function calloutsExtension(options: Options): Extension {
  const build = (state: EditorState, previous?: DecorationSet, tr?: Transaction): DecorationSet => {
    const owners = [...columnBlocks(state.doc), ...visualBlocks(state.doc)];
    const blocks = scanMarkdownCallouts(state.doc.toString()).filter(block => !owners.some(owner => owner.from <= block.from && owner.to >= block.to));
    const identities = blockWidgetIdentities(blocks, previous, tr);
    return Decoration.set(blocks.map(block => Decoration.replace({ block: true, widget: new CalloutWidget(block, options, state.field(blockWidgetLayout).get(block.from) ?? 0, identities.get(block)!) }).range(block.from, block.to)));
  };
  const field = StateField.define<DecorationSet>({ create: build, update: (value, tr) => tr.docChanged || tr.effects.some(effect => effect.is(blockWidgetResized)) ? build(tr.state, value, tr) : value, provide: field => EditorView.decorations.from(field) });
  return [blockWidgetLayout, field, EditorView.baseTheme({
    '.cm-callout-widget': { margin: '0', minWidth: '0' },
    '.cm-callout-widget > .callout-title': { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '0' },
    '.cm-callout-widget > .callout-title input': { flex: '1', minWidth: '0', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none' },
    '.cm-callout-widget > .callout-title select, .cm-callout-widget > .callout-title button': { border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '.8em', cursor: 'pointer' },
    '.cm-callout-widget > .callout-body': { minWidth: '0' },
  })];
}
