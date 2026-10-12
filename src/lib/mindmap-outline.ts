import type { MapDocument, MapNode } from './mindmap-types';
import { summarizeInteractiveHtml } from './mdx/interactive-html';

/** Static Markdown export without changing live nodes, undo history or JSON. */
export function mindmapOutline(doc: MapDocument, interactive: (data: MapNode['data']) => boolean = () => false): string {
  const staticText = (value: string) => summarizeInteractiveHtml(value, block => `${block.title}（交互演示，请在原文章中打开）`);
  const lines: string[] = [];
  const visit = (node: MapNode, depth: number) => {
    const mark = depth <= 6 ? '#'.repeat(depth) : '   '.repeat(depth - 6) + '*';
    let label = staticText(node.data.text);
    if (interactive(node.data)) label += '（交互演示，请在原文章中打开）';
    const summaries = node.data.generalization;
    for (const summary of Array.isArray(summaries) ? summaries : summaries ? [summaries] : []) {
      if (summary && typeof summary === 'object' && typeof summary.text === 'string') label += ` [${staticText(summary.text)}]`;
    }
    lines.push(`${mark} ${label}\n`);
    if (typeof node.data.note === 'string') lines.push(`${staticText(node.data.note)}\n`);
    node.children?.forEach(child => visit(child, depth + 1));
  };
  visit(doc.root, 1);
  return lines.join('\n');
}
