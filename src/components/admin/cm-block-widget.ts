import type { EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { rootEditor } from './cm-columns-state';

const observers = new WeakMap<HTMLElement, ResizeObserver>();
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
export function wrapBlockWidget(card: HTMLElement, parent: EditorView, spacing: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'cm-block-widget';
  wrap.contentEditable = 'false';
  wrap.style.cssText = `display:flow-root;min-width:0;margin:0;padding-block:${spacing}`;
  card.style.marginBlock = '0';
  wrap.append(card);
  let height: number | undefined;
  const observer = new ResizeObserver(entries => {
    if (!wrap.isConnected) return;
    const nextHeight = entries[0]?.borderBoxSize[0]?.blockSize ?? wrap.getBoundingClientRect().height;
    const changed = height !== undefined && height !== nextHeight;
    height = nextHeight;
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
