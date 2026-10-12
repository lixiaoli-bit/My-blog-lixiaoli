import { EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { StateEffect, StateField } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { captureEditorProjection, columnTarget, rootEditor } from './cm-columns-state';

const observers = new WeakMap<HTMLElement, ResizeObserver>();
let identitySequence = 0;
export interface BlockWidgetIdentity { readonly id: number; height: number; focusOnMount?: boolean }
const domIdentities = new WeakMap<HTMLElement, BlockWidgetIdentity>();
export abstract class OwnedBlockWidget extends WidgetType {
  constructor(readonly identity: BlockWidgetIdentity) { super(); }
  abstract readonly block: { from: number; to: number };
  get estimatedHeight(): number { return this.identity.height; }
}

/** Identity belongs to a mapped source range, never to its title or DOM order. */
export function blockWidgetIdentities<B extends { from: number; to: number }>(blocks: B[], previous?: DecorationSet, tr?: Transaction): Map<B, BlockWidgetIdentity> {
  const available = new Map<string, BlockWidgetIdentity>();
  previous?.between(0, tr?.startState.doc.length ?? Number.MAX_SAFE_INTEGER, (from, to, deco) => {
    const widget = deco.spec.widget;
    if (!(widget instanceof OwnedBlockWidget)) return;
    let touched = false, deleted = false;
    tr?.changes.iterChangedRanges((a, b, c, d) => {
      if (a < to && b > from) touched = true;
      if (a <= from && b >= to && c === d) deleted = true;
    });
    if (deleted) return;
    const start = tr?.changes.mapPos(from, touched ? -1 : 1) ?? from;
    const end = tr?.changes.mapPos(to, touched ? 1 : -1) ?? to;
    if (start < end) available.set(`${start}:${end}`, widget.identity);
    // Boundary insertions may belong either to the widget or its surrounding
    // framing. Let the newly parsed range decide, including a final empty line.
    if (tr?.docChanged) for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const left = tr.changes.mapPos(from, a), right = tr.changes.mapPos(to, b);
      if (left < right) available.set(`${left}:${right}`, widget.identity);
    }
  });
  const used = new Set<BlockWidgetIdentity>();
  return new Map(blocks.map(block => {
    const previousIdentity = available.get(`${block.from}:${block.to}`);
    const identity = previousIdentity && !used.has(previousIdentity) ? previousIdentity : { id: ++identitySequence, height: -1, focusOnMount: !!tr?.docChanged && tr.isUserEvent('input') };
    used.add(identity); return [block, identity];
  }));
}

export function ownsBlockWidget(dom: HTMLElement, identity: BlockWidgetIdentity): boolean { return domIdentities.get(dom) === identity; }

/** Use one bounded change so unaffected source positions and selections map normally. */
export function minimalTextChange(before: string, after: string, base = 0): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0, end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
  return { from: base + start, to: base + before.length - end, insert: after.slice(start, after.length - end) };
}

/** Parent update listeners can run inside a child's transaction. Reverse sync must wait. */
export function syncBlockChild(child: EditorView, content: () => string, disposed: () => boolean, setSyncing: (value: boolean) => void): void {
  queueMicrotask(() => {
    if (disposed()) return;
    const changes = minimalTextChange(child.state.doc.toString(), content());
    if (!changes) return;
    setSyncing(true);
    try { child.dispatch({ changes }); } finally { setSyncing(false); }
  });
}

/** Root history owns the text; a nested editor owns the actual caret geometry. */
export function ownedBlockHistory(view: EditorView, forward: boolean): boolean {
  const root = rootEditor(view), active = columnTarget(root), command = forward ? redo : undo;
  if (!active || active === root || !active.hasFocus) return command(root);
  const projection = captureEditorProjection(active), body = active.state.doc.toString(), source = root.state.doc.toString();
  let marker = '\uE000owned-caret\uE001';
  while (body.includes(marker) || source.includes(marker)) marker += '_';
  const position = (offset: number) => {
    const projected = projection?.project(body.slice(0, offset) + marker + body.slice(offset));
    return projected ? minimalTextChange(source, projected)?.from ?? -1 : -1;
  };
  const from = position(0), to = position(body.length);
  command({ state: root.state, dispatch: tr => {
    const head = tr.newSelection.main.head, left = from >= 0 ? tr.changes.mapPos(from, -1) : -1, right = to >= 0 ? tr.changes.mapPos(to, 1) : -1;
    const owned = left >= 0 && head >= left && head <= right;
    // Passing the transaction as a spec preserves its history annotations and
    // effects, while replacing only the root's inappropriate scroll request.
    root.dispatch(owned ? root.state.update({ ...tr, scrollIntoView: false }) : tr);
    if (!owned) return;
    const doc = root.state.doc;
    queueMicrotask(() => {
      if (!root.dom.isConnected || root.state.doc !== doc) return;
      if (active.dom.isConnected && columnTarget(root) === active && active.hasFocus) {
        active.dispatch({ effects: EditorView.scrollIntoView(active.state.selection.main, { y: 'nearest' }) });
      } else if (!active.dom.isConnected) {
        root.focus(); root.dispatch({ effects: EditorView.scrollIntoView(root.state.selection.main, { y: 'nearest' }) });
      }
    });
  } });
  return true;
}
export const blockWidgetResized = StateEffect.define<number>({ map: (position, changes) => changes.mapPos(position) });
export const blockWidgetLayout = StateField.define<ReadonlyMap<number, number>>({
  create: () => new Map(),
  update: (value, tr) => {
    if (!tr.docChanged && !tr.effects.some(effect => effect.is(blockWidgetResized))) return value;
    const next = new Map([...value].map(([position, revision]) => [tr.changes.mapPos(position), revision]));
    for (const effect of tr.effects) if (effect.is(blockWidgetResized)) next.set(effect.value, (next.get(effect.value) ?? 0) + 1);
    return next;
  },
});

/** CM measures a block's border box, excluding vertical margins. Keep card spacing inside that box. */
export function wrapBlockWidget(card: HTMLElement, parent: EditorView, spacing: string, identity?: BlockWidgetIdentity): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cm-block-widget';
  wrap.contentEditable = 'false';
  wrap.style.cssText = `display:flow-root;min-width:0;margin:0;padding-block:${spacing}`;
  card.style.marginBlock = '0';
  wrap.append(card);
  if (identity) { domIdentities.set(wrap, identity); wrap.dataset.editorBlockId = String(identity.id); }
  let height: number | undefined;
  const observer = new ResizeObserver(entries => {
    if (!wrap.isConnected) return;
    const nextHeight = entries[0]?.borderBoxSize[0]?.blockSize ?? wrap.getBoundingClientRect().height;
    const changed = height !== undefined && height !== nextHeight;
    height = nextHeight;
    if (identity) identity.height = nextHeight;
    // Only invalidate this card. Changing every widget's identity discards the
    // heights of offscreen cards and makes a long document jump when one folds.
    const invalidate = (view: EditorView) => {
      if (changed && view.state.field(blockWidgetLayout, false) !== undefined) {
        view.dispatch({ effects: blockWidgetResized.of(view.posAtDOM(wrap, 0)) });
      }
      view.requestMeasure();
    };
    invalidate(parent);
    const root = rootEditor(parent);
    if (root !== parent) invalidate(root);
  });
  observer.observe(wrap);
  observers.set(wrap, observer);
  return wrap;
}

export function blockWidgetContent(wrap: HTMLElement): HTMLElement {
  return wrap.firstElementChild as HTMLElement;
}

export function destroyBlockWidget(wrap: HTMLElement): void {
  observers.get(wrap)?.disconnect();
  observers.delete(wrap);
}
