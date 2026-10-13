import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { activeAiEditor } from '@/lib/ai-editor-bridge';

export default function ArticleCoverUpload({ articleId }: { articleId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [retained, setRetained] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = () => mounted.current && host.current?.isConnected && document.getElementById('doc-detail-data')?.dataset.activeNode === articleId;
  async function upload(file: File) {
    setBusy(true); setMessage('正在上传封面…'); setRetained('');
    try {
      if (!file.type.startsWith('image/')) throw Error('请选择图片文件');
      if (file.size > 3 * 1024 * 1024) throw Error('请选择不超过 3MB 的封面图片');
      const editor = activeAiEditor();
      if (editor && (editor.targetId !== articleId || editor.domain !== 'article' || !await editor.flush())) throw Error('请先保存当前文章');
      if (!active()) return;
      const current = await fetch(`/api/articles/${articleId}`, { cache: 'no-store' });
      if (!current.ok) throw Error('读取文章失败');
      const { article } = await current.json();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file);
      });
      const response = await fetch('/api/images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, mime: file.type, data }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '上传失败');
      if (!active() || (editor && activeAiEditor() !== editor)) return;
      setRetained(result.url);
      const saved = await fetch(`/api/articles/${articleId}/cover`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: result.url, expectedCover: article.cover || '' }) });
      const change = await saved.json();
      if (!saved.ok) throw Error(change.error || '封面保存失败');
      window.dispatchEvent(new CustomEvent('article:cover-changed', { detail: { id: articleId, url: result.url } }));
      if (active()) { setRetained(''); setMessage('封面已上传并应用'); }
    } catch (error) { if (active()) setMessage(error instanceof Error ? error.message : '封面上传失败'); }
    finally { if (mounted.current) setBusy(false); if (input.current) input.current.value = ''; }
  }
  return <span ref={host} className="inline-flex flex-wrap items-center gap-2">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="选择封面图片" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <button type="button" disabled={busy} onClick={() => input.current?.click()} className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs disabled:opacity-50"><Upload size={14} />{busy ? '上传中…' : '上传封面'}</button>
    <span role="status" className="text-xs text-muted-foreground">{message}{retained && <> · <a href={retained} target="_blank" rel="noopener noreferrer">打开已上传图片</a></>}</span>
  </span>;
}
