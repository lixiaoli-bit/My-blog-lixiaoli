import { navigate } from 'astro:transitions/client';
import { installTreeContextMenu } from '@/lib/tree-context-menu';
import { confirmDanger } from '@/lib/confirm';
function mount(): void {
  const grid = document.getElementById('post-grid');
  if (!grid || grid.dataset.canManage !== '1' || grid.dataset.cardMenuBound) return;
  grid.dataset.cardMenuBound = '1';
  let pending = false;
  installTreeContextMenu(grid, async (command, target) => {
    if (!target.id || pending) return;
    if (command === 'edit') { await navigate(`/edit/${encodeURIComponent(target.id)}?edit=1`); return; }
    if (command !== 'delete' || !(await confirmDanger(`确定删除文章「${target.title}」？`))) return;
    pending = true;
    try {
      const response = await fetch(`/api/articles/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      if (!response.ok) throw Error('文章删除失败，请检查登录状态并重试');
      const row = [...grid.querySelectorAll<HTMLElement>('[data-home-article-id]')].find(item => item.dataset.homeArticleId === target.id);
      row?.remove();
      const url = new URL(location.href), page = Number(url.searchParams.get('page') || 1);
      if (!grid.querySelector('[data-home-article-id]') && page > 1) url.searchParams.set('page', String(page - 1));
      await navigate(url.pathname + url.search, { history: 'replace' });
    } catch (cause) {
      let status = document.getElementById('home-card-status');
      if (!status) { status = document.createElement('p'); status.id = 'home-card-status'; status.role = 'alert'; status.className = 'text-sm text-destructive'; grid.after(status); }
      status.textContent = cause instanceof Error ? cause.message : '文章删除失败，请重试';
    } finally { pending = false; }
  }, { label: '文章操作', resolveTarget: element => {
    const row = element.closest<HTMLElement>('[data-home-article-id]');
    return row ? { id: row.dataset.homeArticleId!, title: row.dataset.homeArticleTitle || '未命名', kind: 'article' } : null;
  } });
}
mount(); document.addEventListener('astro:page-load', mount);
