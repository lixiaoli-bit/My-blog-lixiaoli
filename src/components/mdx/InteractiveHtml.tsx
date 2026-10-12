import type { InteractiveBlock } from '../../lib/interactive-html';
import { prepareInteractiveDocument } from '../../lib/interactive-html-document';

export default function InteractiveHtml({ payload = '', sourceKey = '' }: { payload?: string; sourceKey?: string }) {
  const block = JSON.parse(payload) as InteractiveBlock;
  let error = block.error || '';
  let prepared = { document: '', warnings: [] as string[] };
  if (!error) try { prepared = prepareInteractiveDocument(block.source); } catch (value) { error = (value as Error).message; }
  return <section className="interactive-html not-prose" data-interactive-card data-source-key={sourceKey || undefined} data-interactive-id={block.key}>
    <header><strong>{block.title}</strong><span data-interactive-status role="status">{error || '等待运行'}</span></header>
    <div className="interactive-html-actions">
      <button type="button" data-interactive-action="run" disabled={!!error}>运行</button>
      <button type="button" data-interactive-action="expand" disabled={!!error}>放大</button>
      <button type="button" data-interactive-action="source">查看源码</button>
    </div>
    <div data-interactive-stage style={{ minHeight: `${block.initialHeight}px` }} />
    <details data-interactive-errors hidden={!error && !prepared.warnings.length}><summary>运行信息</summary><pre>{[error, ...prepared.warnings].filter(Boolean).join('\n')}</pre></details>
    <details data-interactive-source-view hidden><summary>HTML 源码</summary><pre><code>{block.source}</code></pre></details>
    <template data-interactive-payload>{JSON.stringify({ ...block, error, ...prepared })}</template>
  </section>;
}
