import type { EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { rootEditor } from './cm-columns-state';

const observers = new WeakMap<HTMLElement, ResizeObserver>();
export const blockWidgetResized = StateEffect.define<void>();
export const blockWidgetLayout = StateField.define<number>({
  create: () => 0,
  update: (value, tr) => tr.effects.some(effect => effect.is(blockWidgetResized)) ? value + 1 : value,
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
    // A fixed-height content DOM can stay the same size when a card folds. In that
    // case requestMeasure alone does not invalidate CM's block height map. A new
    // decoration identity does, while updateDOM preserves the existing child editor.
    const invalidate = (view: EditorView) => {
      if (changed && view.state.field(blockWidgetLayout, false) !== undefined) view.dispatch({ effects: blockWidgetResized.of() });
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
