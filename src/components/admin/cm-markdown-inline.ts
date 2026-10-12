import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Text } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { PreviewDecoration } from './cm-preview-cache';

interface InlineSpan {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  className?: string;
  markers: Array<[number, number]>;
  literal: boolean;
}
const cache = new WeakMap<Text, Map<number, InlineSpan[]>>();
const classes: Record<string, string> = {
  StrongEmphasis: 'cm-lp-strong', Emphasis: 'cm-lp-em', InlineCode: 'cm-lp-inline-code', Strikethrough: 'cm-lp-del',
};

/** Use the editor's GFM parser and cache complete ranges by immutable document.
 * Parsing here avoids depending on a viewport-limited, partially available language tree.
 * Both preview variants share the result; caret movement never reparses the document.
 */
export function markdownInlineSpans(doc: Text): Map<number, InlineSpan[]> {
  const existing = cache.get(doc);
  if (existing) return existing;
  const rows = new Map<number, InlineSpan[]>();
  markdownLanguage.parser.parse(doc.toString()).iterate({ enter(ref) {
    if (['FencedCode', 'CodeBlock', 'Link', 'Image'].includes(ref.name)) return false;
    const className = classes[ref.name];
    const escape = ref.name === 'Escape';
    if (!className && !escape) return;
    const node = ref.node;
    const first = node.firstChild, last = node.lastChild;
    if (!escape && (!first || !last || first.from === last.from)) return;
    const span: InlineSpan = {
      from: ref.from, to: ref.to,
      contentFrom: escape ? ref.from + 1 : first!.to,
      contentTo: escape ? ref.to : last!.from,
      className, literal: escape || ref.name === 'InlineCode',
      markers: escape ? [[ref.from, ref.from + 1]] : [[first!.from, first!.to], [last!.from, last!.to]],
    };
    for (let row = doc.lineAt(ref.from).number - 1; row < doc.lineAt(ref.to).number; row++) {
      const spans = rows.get(row) ?? [];
      spans.push(span);
      rows.set(row, spans);
    }
  } });
  cache.set(doc, rows);
  return rows;
}

/** Nested marks may overlap; replacements must not overlap widget or custom-syntax ranges. */
export function appendMarkdownInline(
  spans: InlineSpan[], line: { from: number; to: number }, occupied: Array<[number, number]>, items: PreviewDecoration[],
): void {
  const overlaps = (from: number, to: number) => occupied.some(([a, b]) => from < b && to > a);
  for (const span of spans) {
    if (span.literal ? overlaps(span.from, span.to) : span.markers.some(([from, to]) => overlaps(from, to))) continue;
    for (const [start, end] of span.markers) {
      const from = Math.max(start, line.from), to = Math.min(end, line.to);
      if (from < to) items.push({ from, to, deco: Decoration.replace({}), reveal: true, revealFrom: span.from, revealTo: span.to });
    }
    const from = Math.max(span.contentFrom, line.from), to = Math.min(span.contentTo, line.to);
    if (span.className && from < to) items.push({ from, to, deco: Decoration.mark({ class: span.className }) });
    if (span.literal) occupied.push([span.from, span.to]);
  }
}
