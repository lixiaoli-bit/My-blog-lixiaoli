/** All article view controls use the host bridge, including nested editor menus. */
export type ArticleViewMode = 'preview' | 'visual' | 'source';
const views: Array<{ mode: ArticleViewMode; label: string }> = [
  { mode: 'preview', label: '预览模式' }, { mode: 'visual', label: '编辑模式' }, { mode: 'source', label: '源码模式' },
];
export function articleViewMenuItems(): Array<{ label: string; action: () => Promise<void> }> {
  const bridge = window.__docInlineEditor;
  if (!bridge?.switchMode) return [];
  return views.map(({ mode, label }) => ({
    label: `${bridge.getMode?.() === mode ? '✓ ' : ''}${label}`,
    action: async () => { await window.__docInlineEditor?.switchMode?.(mode); },
  }));
}

/** Attach a submenu inside the owning portal so outside-click handlers keep it open. */
export function appendArticleViewMenu(menu: HTMLElement, close: () => void): () => void {
  if (!window.__docInlineEditor?.switchMode) return () => {};
  const controller = new AbortController(), { signal } = controller;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.role = 'menuitem'; trigger.className = 'md-context-item';
  trigger.textContent = '切换视图 ›'; trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'md-context-menu article-view-submenu'; panel.role = 'menu'; panel.setAttribute('aria-label', '切换视图'); panel.hidden = true;
  const hide = (): void => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const show = (focus = false): void => {
    panel.replaceChildren();
    for (const { mode, label } of views) {
      const button = document.createElement('button'); button.type = 'button'; button.role = 'menuitemradio'; button.className = 'md-context-item';
      const checked = window.__docInlineEditor?.getMode?.() === mode;
      button.textContent = `${checked ? '✓ ' : ''}${label}`; button.setAttribute('aria-checked', String(checked));
      button.addEventListener('click', event => { event.stopPropagation(); close(); void window.__docInlineEditor?.switchMode?.(mode); }, { signal });
      panel.append(button);
    }
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, rect.right + width < innerWidth - 8 ? rect.right - 2 : rect.left - width + 2)}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - height - 8))}px`;
    if (focus) panel.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  };
  trigger.addEventListener('pointerenter', () => show(), { signal });
  trigger.addEventListener('click', event => { event.stopPropagation(); show(true); }, { signal });
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); show(true); } }, { signal });
  menu.addEventListener('pointerover', event => { if (!trigger.contains(event.target as Node) && !panel.contains(event.target as Node)) hide(); }, { signal });
  panel.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'ArrowLeft') { event.preventDefault(); hide(); trigger.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }, { signal });
  menu.append(trigger, panel);
  return () => { controller.abort(); trigger.remove(); panel.remove(); };
}
