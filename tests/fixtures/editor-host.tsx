import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import DocInlineEditor from '../../src/components/doc/DocInlineEditor';
import CalendarDiaryDialog from '../../src/components/admin/CalendarDiaryDialog';
import QuickNoteFloat from '../../src/components/quick-notes/QuickNoteFloat';
import { saveArticleSnapshot, setArticleContentVersion } from '../../src/lib/pending-article-saves';
import '../../src/styles/global.css';
import 'katex/dist/katex.min.css';

const kind = new URLSearchParams(location.search).get('kind') || 'home';
const harnessWindow = window as any;
harnessWindow.hostKernel = { kind, view: () => EditorView.findFromDOM(document.querySelector('.cm-editor')!), save: saveArticleSnapshot, version: setArticleContentVersion };
createRoot(document.getElementById('root')!).render(kind === 'calendar' ? <CalendarDiaryDialog /> : kind === 'quick' ? <QuickNoteFloat /> :
  <section data-article-domain={kind === 'doc' ? 'docs' : 'home'} style={{ maxWidth: 1000, margin: '24px auto' }}>
    <div id="doc-3col" data-editing="false"><main><h1>回归文章</h1>
      <button id="doc-inline-edit" onClick={() => harnessWindow.__docInlineEditor?.open()}>编辑</button>
      <button id="doc-inline-source" onClick={() => harnessWindow.__docInlineEditor?.open('source')}>源码</button>
      <button id="doc-inline-preview" onClick={() => harnessWindow.__docInlineEditor?.saveAndClose?.()}>预览</button>
      <article className="prose"><p>测试正文</p></article><DocInlineEditor />
    </main></div>
    <div id="doc-detail-data" data-active-node="study" data-raw-title="回归文章" /><div id="doc-toc-list" />
  </section>);
