import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { visualBlocks, visualEdit, visualTransactionCache } from '../src/components/admin/cm-visual-directives-state';
const source = ':::tabs\n@tab A\n\nFirst\n\n@tab B\n\nSecond\n\n:::';
describe('owned visual body boundaries', () => {
  it('retains an authored final newline while framing remains outside the child', () => {
    const state = EditorState.create({ doc: source, extensions: visualTransactionCache });
    const block = visualBlocks(state.doc)[0]!, body = block.items[1]!.body!;
    const nextSource = source.slice(0, body.to) + '\n' + source.slice(body.to);
    const owned = { ...block, to: block.to + 1, raw: nextSource, closing: { ...block.closing, from: block.closing.from + 1, to: block.closing.to + 1 },
      items: block.items.map((item, i) => i === 1 ? { ...item, body: { ...body, to: body.to + 1, text: body.text + '\n' } } : item) };
    const next = state.update({ changes: { from: body.to, insert: '\n' }, annotations: visualEdit.of(owned) }).state;
    expect(visualBlocks(next.doc)[0]!.items[1]!.body!.text).toBe('Second\n');
    const moved = next.update({ changes: { from: 0, insert: 'Intro\n\n' } }).state;
    expect(visualBlocks(moved.doc)[0]!.items[1]!.body!.text).toBe('Second\n');
    expect(moved.doc.sliceString(visualBlocks(moved.doc)[0]!.items[1]!.body!.from, visualBlocks(moved.doc)[0]!.items[1]!.body!.to)).toBe('Second\n');
  });
  it('reparses ordinary source edits instead of keeping an invalid container', () => {
    const state = EditorState.create({ doc: source, extensions: visualTransactionCache });
    const next = state.update({ changes: { from: 0, to: 7, insert: 'ordinary' } }).state;
    expect(visualBlocks(next.doc)).toEqual([]);
  });
});
