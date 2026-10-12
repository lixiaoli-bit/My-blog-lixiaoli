import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import { normalizeSource, renderMdx } from '../src/lib/mdx';
import { interactiveOptions, interactiveTemplate, readInteractiveFile } from '../src/lib/interactive-html';
import { collectInteractiveBlocks } from '../src/lib/mdx/interactive-html';
import { prepareInteractiveDocument, INTERACTIVE_CSP } from '../src/lib/interactive-html-document';
import { buildSourceIndex } from '../src/lib/source-block-index';
import { sourceChunks } from '../src/lib/mindmap-ai';
import { mindmapOutline } from '../src/lib/mindmap-outline';

const source = '<script>const code={text:"｀ ˋ ‵ {x} $$x$$ :::tabs ==tip:x==",value:1 < 2};</script>\n<button onclick="this.textContent=\'已点击\'">开始</button>';
const fence = (meta = '') => `\`\`\`html-interactive ${meta}\n${source}\n\`\`\``;
const parseHtml = (html: string) => unified().use(rehypeParse).parse(html);
function elements(tree: any, name: string): any[] { return [...(tree.tagName === name ? [tree] : []), ...(tree.children || []).flatMap((child: any) => elements(child, name))]; }

describe('interactive HTML pipeline', () => {
  it('preserves literal scripts through normalization, rendering and metadata without server execution', async () => {
    const input = fence('title="演示" id="demo" height="320"');
    expect(collectInteractiveBlocks(normalizeSource(input))[0]!.source).toBe(source);
    const result = await renderMdx(input);
    expect(result.interactiveBlocks?.[0]).toMatchObject({ source, title: '演示', id: 'demo', initialHeight: 320 });
    const tree = parseHtml(result.html);
    expect(elements(tree, 'script')).toHaveLength(0);
    expect(elements(tree, 'iframe')).toHaveLength(0);
    expect(result.html).toContain('data-interactive-card');
    const template = elements(tree, 'template')[0];
    expect(JSON.parse(template.content.children[0].value).source).toBe(source);
  });
  it('keeps ordinary HTML fences inert and surrounding formulas and headings intact', async () => {
    const result = await renderMdx(`## 章节\n\n${fence()}\n\n$ x^2 $\n\n\`\`\`html\n<script>throw Error("never")</script>\n\`\`\``);
    expect(result.toc[0]?.text).toBe('章节');
    expect(result.html).toContain('katex');
    expect(elements(parseHtml(result.html), 'script')).toHaveLength(0);
    expect(result.interactiveBlocks).toHaveLength(1);
  });
  it('isolates bad parameters, duplicate IDs and oversized blocks instead of breaking the article', async () => {
    for (const meta of ['height="10"','title="a" title="b"','sandbox="allow-same-origin"']) {
      const result = await renderMdx(`${fence(meta)}\n\n正文仍在`);
      expect(result.interactiveBlocks?.[0]?.error).toBeTruthy();
      expect(result.html).toContain('正文仍在');
    }
    const duplicate = await renderMdx(`${fence('id="demo"')}\n\n${fence('id="demo"')}`);
    expect(duplicate.interactiveBlocks?.[1]?.error).toContain('重复');
    const oversized = await renderMdx(`\`\`\`html-interactive\n${'中'.repeat(90000)}\n\`\`\``);
    expect(oversized.interactiveBlocks?.[0]?.error).toContain('256 KiB');
  });
  it('supports nested containers and quote fences as whole source units', async () => {
    const quoted = `> [!tip] 演示卡\n>\n${fence('title="计数器"').split('\n').map(line => `> ${line}`).join('\n')}`;
    const index = await buildSourceIndex(quoted);
    expect(index.blocks.find(block => block.kind === 'interactive-html')?.text).toBe('计数器');
    expect(collectInteractiveBlocks(index.blocks.find(block => block.kind === 'interactive-html')!.markdown)[0]!.source).toBe(source);
    const result = await renderMdx(`:::tabs\n\n@tab 演示\n\n${fence()}\n\n@tab 说明\n\n说明\n\n:::`);
    expect(result.html).toContain('data-interactive-card');
    expect(result.html).toContain('role="tab"');
    const next = await buildSourceIndex(`## 新章节\n\n${quoted}`, index);
    expect(next.blocks.find(block => block.kind === 'interactive-html')?.blockId).toBe(index.blocks.find(block => block.kind === 'interactive-html')?.blockId);
  });
  it('keeps scripts out of AI source chunks and preserves their real source identities', async () => {
    const index = await buildSourceIndex(fence('title="调度演示"'));
    const chunks = sourceChunks(index.blocks, 3000);
    expect(chunks[0]?.[0]?.blockId).toBe(index.blocks[0]?.blockId);
    expect(chunks[0]?.[0]?.markdown).toContain('调度演示');
    expect(chunks[0]?.[0]?.markdown).not.toContain('<script>');
    const parent = await buildSourceIndex(`> [!NOTE] 演示讲解\n>\n${fence('title="卡片中的演示"').split('\n').map(line => `> ${line}`).join('\n')}`);
    const nested = sourceChunks(parent.blocks, 3000).flat();
    expect(nested.find(block => block.kind === 'callout')?.markdown).toContain('卡片中的演示');
    expect(nested.some(block => block.markdown.includes('<script>'))).toBe(false);
  });
});
describe('runtime documents and import', () => {
  it('exports static outline titles without altering JSON source or relationships', () => {
    const doc = {root:{data:{text:'文章根',uid:'root'},children:[
      {data:{text:fence('title="公式演示"'),uid:'inline',note:'普通备注'}},
      {data:{text:'**已改名**',uid:'linked',generalization:{text:'归纳'}}}
    ]}};
    const before = JSON.stringify(doc);
    const outline = mindmapOutline(doc, data => data.uid === 'linked');
    expect(outline).toContain('公式演示（交互演示');
    expect(outline).toContain('**已改名**（交互演示');
    expect(outline).toContain('[归纳]');
    expect(outline).toContain('普通备注');
    expect(outline).not.toContain('html-interactive');
    expect(outline).not.toContain('<script>');
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('prepends policy and bridge to full documents and reports external dependencies', () => {
    const prepared = prepareInteractiveDocument('<!doctype html><html><head><script src="https://example.com/lib.js"></script><base href="https://example.com"><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><iframe src="https://example.com"></iframe><img src="pic.png"><script>let count=0</script></body></html>');
    const tree = parseHtml(prepared.document);
    expect(elements(tree, 'iframe')).toHaveLength(0);
    expect(elements(tree, 'base')).toHaveLength(0);
    expect(elements(tree, 'script').some(script => script.properties.src)).toBe(false);
    expect(prepared.warnings.length).toBeGreaterThan(0);
    expect(elements(tree, 'meta').find(meta => meta.properties.content === INTERACTIVE_CSP)).toBeTruthy();
    expect(prepared.document.indexOf('Content-Security-Policy')).toBeLessThan(prepared.document.indexOf('let count=0'));
  });
  it('imports UTF-8 HTML losslessly and chooses a longer Markdown fence', async () => {
    const value = '<p>中文</p>\n<script>const example="````";</script>';
    const file = new File([value], '演示.html', { type: 'text/html' });
    const imported = await readInteractiveFile(file);
    expect(imported).toEqual({ source: value, title: '演示' });
    const template = interactiveTemplate(imported.source, imported.title);
    expect(template.source.startsWith('`````html-interactive')).toBe(true);
    expect(collectInteractiveBlocks(template.source)[0]?.source).toBe(value);
    await expect(readInteractiveFile(new File([new Uint8Array([0xff])], 'bad.html'))).rejects.toThrow('UTF-8');
    await expect(readInteractiveFile(new File(['x'], 'bad.txt'))).rejects.toThrow('.html');
    await expect(readInteractiveFile(new File(['x'.repeat(262145)], 'big.html'))).rejects.toThrow('256 KiB');
  });
  it('validates bounded options and rejects unknown capabilities', () => {
    expect(interactiveOptions()).toEqual({ id: undefined, title: '交互演示', initialHeight: 360 });
    expect(() => interactiveOptions('id="123"')).toThrow();
    expect(() => interactiveOptions('height="NaN"')).toThrow();
    expect(() => interactiveOptions('src="https://example.com"')).toThrow();
  });
});
