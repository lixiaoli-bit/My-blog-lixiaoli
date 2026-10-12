import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Node } from 'mdast';
import { interactiveOptions, validateInteractiveSource, type InteractiveBlock } from '../interactive-html';
import { jsxAttr, jsxFlow } from './nodes';
interface CodeNode { type: string; lang?: string; meta?: string; value?: string; children?: CodeNode[]; data?: { sourceKey?: string } }
export function interactiveCodeBlock(node: CodeNode, ordinal: number, ids: Set<string>): InteractiveBlock {
  let options = { title: '交互演示', initialHeight: 360, id: undefined as string | undefined };
  let error: string | undefined;
  try {
    options = { ...options, ...interactiveOptions(node.meta) };
    validateInteractiveSource(node.value || '');
    if (options.id && ids.has(options.id)) throw Error(`演示 id “${options.id}”重复，请修改为唯一 id`);
    if (options.id) ids.add(options.id);
  } catch (value) { error = (value as Error).message; }
  return { ...options, key: options.id || `interactive-${ordinal}`, source: node.value || '', ...(error ? { error } : {}) };
}
export function collectInteractiveBlocks(source: string): InteractiveBlock[] {
  const tree = unified().use(remarkParse).parse(source);
  const blocks: InteractiveBlock[] = [], ids = new Set<string>();
  const visit = (node: CodeNode) => {
    if (node.type === 'code' && node.lang === 'html-interactive') blocks.push(interactiveCodeBlock(node, blocks.length + 1, ids));
    node.children?.forEach(visit);
  };
  visit(tree as unknown as CodeNode);
  return blocks;
}
/** Remove executable source from AI knowledge prompts, including enclosing Callouts/lists. */
export function summarizeInteractiveHtml(source: string, format: (block: InteractiveBlock) => string = block => `交互演示：${block.title}。按标题整理，完整页面在原文演示中运行，不分析脚本。`): string {
  if (!source.includes('html-interactive')) return source;
  const tree = unified().use(remarkParse).parse(source);
  const replacements: {start: number; end: number; value: string}[] = [];
  const visit = (node: Node) => {
    const code = node as unknown as CodeNode;
    if (code.type === 'code' && code.lang === 'html-interactive' && node.position?.start.offset !== undefined && node.position?.end.offset !== undefined) {
      const block = interactiveCodeBlock(code, 1, new Set());
      replacements.push({start:node.position.start.offset,end:node.position.end.offset,value:format(block)});
    }
    (node as {children?: Node[]}).children?.forEach(visit);
  };
  visit(tree);
  for (const replacement of replacements.reverse()) source = source.slice(0,replacement.start) + replacement.value + source.slice(replacement.end);
  return source;
}
export function remarkInteractiveHtml() {
  return (tree: Root) => {
    let ordinal = 0;
    const ids = new Set<string>();
    const visit = (parent: { children?: Node[] }) => {
      if (!parent.children) return;
      parent.children = parent.children.map(node => {
        const code = node as unknown as CodeNode;
        if (code.type === 'code' && code.lang === 'html-interactive') {
          const block = interactiveCodeBlock(code, ++ordinal, ids);
          return jsxFlow('InteractiveHtml', [jsxAttr('payload', JSON.stringify(block)), jsxAttr('sourceKey', code.data?.sourceKey || '')], []);
        }
        visit(node as { children?: Node[] }); return node;
      });
    };
    visit(tree);
  };
}
