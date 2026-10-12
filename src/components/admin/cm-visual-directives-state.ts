import { Annotation, EditorState } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { scanVisualDirectives } from '../../lib/markdown-visual-directives';
import type { SourcePart, VisualBlock } from '../../lib/markdown-visual-directives';

const cache = new WeakMap<Text, VisualBlock[]>();
export const visualEdit = Annotation.define<VisualBlock>();
export function visualBlocks(doc: Text): VisualBlock[] {
  let value = cache.get(doc);
  if (!value) { value = scanVisualDirectives(doc.toString()); cache.set(doc, value); }
  return value;
}
/** Keep authored empty lines separate from a directive's blank framing. */
export const visualTransactionCache = EditorState.transactionExtender.of(tr => {
  if (!tr.docChanged) return null;
  const source = tr.newDoc.toString(), owned = tr.annotation(visualEdit), preserved: VisualBlock[] = [];
  const part = (p: SourcePart): SourcePart => {
    const from = tr.changes.mapPos(p.from, 1), to = tr.changes.mapPos(p.to, -1);
    return { from, to, text: source.slice(from, to) };
  };
  for (const block of visualBlocks(tr.startState.doc)) {
    let touched = false;
    tr.changes.iterChangedRanges((a, b) => { if (a < block.to && b > block.from || a === b && a > block.from && a < block.to) touched = true; });
    if (touched) continue;
    const from = tr.changes.mapPos(block.from, 1), to = tr.changes.mapPos(block.to, -1);
    preserved.push({ ...block, from, to, raw: source.slice(from, to), opening: part(block.opening), closing: part(block.closing),
      items: block.items.map(item => ({ ...item, heading: part(item.heading), body: item.body && part(item.body), alt: item.alt && part(item.alt), url: item.url && part(item.url), caption: item.caption && part(item.caption) })) });
  }
  if (owned) preserved.push(owned);
  cache.set(tr.newDoc, [...scanVisualDirectives(source).filter(block => !preserved.some(other => block.from < other.to && block.to > other.from)), ...preserved].sort((a, b) => a.from - b.from));
  return null;
});
