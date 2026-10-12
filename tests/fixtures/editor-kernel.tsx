import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { undo, redo, undoDepth } from '@codemirror/commands';
import MarkdownEditor, { type MarkdownEditorHandle } from '../../src/components/admin/MarkdownEditor';
import * as visualModule from '../../src/components/admin/cm-wysiwyg';
import '../../src/styles/global.css';
import 'katex/dist/katex.min.css';

function Harness() {
  const ref = useRef<MarkdownEditorHandle>(null);
  const [doc, setDoc] = useState('');
  const [key, setKey] = useState(0);
  const [source, setSource] = useState(false);
  const state = (window as any).kernel ??= { ready: false, content: '' };
  state.load = (value: string) => { state.ready = false; state.content = value; setDoc(value); setSource(false); setKey(n => n + 1); };
  state.mode = (value: boolean) => setSource(value);
  state.view = () => EditorView.findFromDOM(document.querySelector('#root .cm-editor')!);
  state.snapshot = () => {
    const v = state.view();
    return { source: ref.current?.getSource(), head: v.state.selection.main.head, undoDepth: undoDepth(v.state) };
  };
  state.undo = () => undo(state.view());
  state.redo = () => redo(state.view());
  state.flush = () => ref.current?.flushInputs();
  return <main className="doc-ie-view" style={{ maxWidth: 1000, margin: '24px auto', height: 720 }}>
    <MarkdownEditor key={key} ref={ref} initialContent={doc} wysiwyg initialWysiwyg={visualModule} sourceMode={source} variant="ghost" className="h-full"
      onReady={() => state.ready = true} onChange={value => state.content = value} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
