export const INTERACTIVE_MAX_BYTES = 256 * 1024;
export interface InteractiveBlock {
  key: string;
  id?: string;
  title: string;
  source: string;
  initialHeight: number;
  error?: string;
}
export function interactiveOptions(meta: string | null = ''): { id?: string; title: string; initialHeight: number } {
  const options: Record<string, string> = {};
  let remaining = (meta ?? '').trim();
  while (remaining) {
    const match = /^(id|title|height)=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s]+))(?:\s+|$)/.exec(remaining);
    if (!match || options[match[1]!] !== undefined) throw Error('交互 HTML 参数无效，仅支持 id、title、height，且不能重复');
    options[match[1]!] = match[2] ?? match[3] ?? match[4]!;
    remaining = remaining.slice(match[0].length);
  }
  if (options.id && !/^[A-Za-z][\w-]{0,79}$/.test(options.id)) throw Error('演示 id 需以字母开头，最多 80 个字母、数字、下划线或短横线');
  const initialHeight = Number(options.height ?? 360);
  if (!Number.isInteger(initialHeight) || initialHeight < 200 || initialHeight > 960) throw Error('演示初始高度需为 200～960 的整数');
  const title = options.title?.trim() || '交互演示';
  if (title.length > 200) throw Error('演示标题不能超过 200 字');
  return { id: options.id, title, initialHeight };
}
export function validateInteractiveSource(source: string): void {
  if (new TextEncoder().encode(source).byteLength > INTERACTIVE_MAX_BYTES) throw Error('单个交互 HTML 不能超过 256 KiB');
  if (!source.trim() || source.includes('\0')) throw Error('交互 HTML 为空或含无效字符');
}
export function interactiveTemplate(source = '<p>点击按钮：</p>\n<button onclick="this.textContent = Number(this.textContent) + 1">0</button>', title = '交互演示') {
  validateInteractiveSource(source);
  let length = 3;
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  const header = `${fence}html-interactive title=${JSON.stringify(title.replace(/[\r\n"]/g, '').slice(0, 200))} height="360"\n`;
  return { source: `${header}${source}\n${fence}`, focusFrom: header.length, focusTo: header.length + source.length };
}
export async function readInteractiveFile(file: File): Promise<{ source: string; title: string }> {
  if (!/\.html?$/i.test(file.name)) throw Error('请选择 .html 或 .htm 文件');
  if (file.size > INTERACTIVE_MAX_BYTES) throw Error('HTML 文件不能超过 256 KiB');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw Error('HTML 文件需使用 UTF-8 编码'); }
  validateInteractiveSource(source);
  return { source, title: file.name.replace(/\.html?$/i, '') || '交互演示' };
}
