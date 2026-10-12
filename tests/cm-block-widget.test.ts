import { describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { scanMarkdownCallouts } from '../src/lib/markdown-callouts';
import { blockWidgetIdentities, minimalTextChange, OwnedBlockWidget } from '../src/components/admin/cm-block-widget';
import type { BlockWidgetIdentity } from '../src/components/admin/cm-block-widget';

class TestWidget extends OwnedBlockWidget {
  constructor(readonly block: { from: number; to: number }, identity: BlockWidgetIdentity) { super(identity); }
  toDOM(): HTMLElement { throw Error('State-only test'); }
}
function build(state: EditorState, previous?: DecorationSet, tr?: Transaction) {
  const blocks = scanMarkdownCallouts(state.doc.toString()), ids = blockWidgetIdentities(blocks, previous, tr);
  return Decoration.set(blocks.map(b => Decoration.replace({ block: true, widget: new TestWidget(b, ids.get(b)!) }).range(b.from, b.to)));
}
const field = StateField.define<DecorationSet>({ create: build, update: (v, tr) => tr.docChanged ? build(tr.state, v, tr) : v });
const first = '> [!note] Same\n> First body', second = '> [!note] Same\n> Second body';
function widgets(state: EditorState) { const items: TestWidget[] = []; state.field(field).between(0, state.doc.length, (_, __, d) => { items.push(d.spec.widget); }); return items; }

describe('widget identity follows source transactions', () => {
  it('keeps equal-title siblings distinct and preserves measured height after an edit', () => {
    const state = EditorState.create({ doc: first + '\n\n' + second, extensions: field });
    const [a, b] = widgets(state); a!.identity.height = 180; b!.identity.height = 95;
    const at = state.doc.toString().indexOf('First') + 2;
    const next = state.update({ changes: { from: at, insert: '\n> new' } }).state;
    const [nextA, nextB] = widgets(next);
    expect(a!.identity).not.toBe(b!.identity);
    expect(nextA!.identity).toBe(a!.identity); expect(nextB!.identity).toBe(b!.identity);
    expect(nextA!.estimatedHeight).toBe(180); expect(nextB!.estimatedHeight).toBe(95);
  });
  it('maps an unaffected widget when text is inserted exactly before it', () => {
    const state = EditorState.create({ doc: first, extensions: field }), [a] = widgets(state);
    const next = state.update({ changes: { from: 0, insert: 'Introduction\n\n' } }).state;
    expect(widgets(next)[0]!.identity).toBe(a!.identity);
  });
  it('does not transfer a deleted block identity to its next sibling', () => {
    const state = EditorState.create({ doc: first + '\n\n' + second, extensions: field }), [a, b] = widgets(state);
    const next = state.update({ changes: { from: 0, to: first.length + 2 } }).state;
    expect(widgets(next)[0]!.identity).toBe(b!.identity);
    expect(widgets(next)[0]!.identity).not.toBe(a!.identity);
  });
  it('preserves the edited block on a complete replacement without merging siblings', () => {
    const state = EditorState.create({ doc: first + '\n\n' + second, extensions: field }), [a, b] = widgets(state);
    const next = state.update({ changes: { from: 0, to: first.length, insert: first.replace('First', 'Rewritten first') } }).state;
    expect(widgets(next)[0]!.identity).toBe(a!.identity); expect(widgets(next)[1]!.identity).toBe(b!.identity);
  });
  it('keeps a body editor when a new final line grows its source range', () => {
    const state = EditorState.create({ doc: first, extensions: field }), [a] = widgets(state);
    const next = state.update({ changes: { from: first.length, insert: '\n> ' } }).state;
    expect(widgets(next)[0]!.identity).toBe(a!.identity);
  });
});

describe('bounded source updates', () => {
  it('inserts a newline without replacing unaffected paragraphs', () => {
    expect(minimalTextChange('First\nSecond\nThird', 'First\nSec\nond\nThird', 10)).toEqual({ from: 19, to: 19, insert: '\n' });
  });
  it('returns no change for an acknowledged child body', () => { expect(minimalTextChange('same', 'same')).toBeNull(); });
});
