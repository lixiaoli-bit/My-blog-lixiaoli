import { EditorView, WidgetType } from '@codemirror/view';
import { interactiveOptions, type InteractiveBlock } from '../../lib/interactive-html';
import type { InteractiveInstance } from '../../lib/interactive-html-client';
import { collectInteractiveBlocks } from '../../lib/mdx/interactive-html';
import { rootEditor } from './cm-columns-state';
export class InteractiveCodeWidget extends WidgetType {
  private instance?: InteractiveInstance;
  constructor(readonly source: string, readonly meta: string, readonly pos: number) { super(); }
  eq(other: InteractiveCodeWidget) { return this.source === other.source && this.meta === other.meta; }
  toDOM(): HTMLElement {
    const root = document.createElement('div'); root.className = 'cm-interactive-html'; root.dataset.interactiveManual = '';
    const label = document.createElement('p'); label.textContent = '交互 HTML · 内容已更新，点击运行预览';
    const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = '运行预览';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑源码';
    const stage = document.createElement('div'); root.append(label, preview, edit, stage);
    let options: InteractiveBlock;
    try { const parsed = interactiveOptions(this.meta); options = { ...parsed, key: parsed.id || `editor-${this.pos}`, source: this.source }; label.textContent = `${options.title} · 内容已更新，点击运行预览`; }
    catch (error) { label.textContent = (error as Error).message; preview.disabled = true; }
    const prevent = (event: Event) => event.stopPropagation();
    root.addEventListener('mousedown', prevent); root.addEventListener('pointerdown', prevent);
    edit.onclick = () => {
      const view = EditorView.findFromDOM(root); if (!view) return;
      let position = this.pos; try { position = view.posAtDOM(root, 0); } catch { /* Fall back only if widget has not moved. */ }
      view.dispatch({ selection: { anchor: position } }); view.focus();
    };
    preview.onclick = async () => {
      preview.disabled = true;
      try {
        const view = EditorView.findFromDOM(root);
        if (view && options.id) {
          const matches = collectInteractiveBlocks(rootEditor(view).state.doc.toString()).filter(block => block.id === options.id);
          if (matches.length > 1) throw Error(`演示 id “${options.id}”重复，请修改为唯一 id`);
        }
        const { createInteractiveCard, mountInteractiveCard } = await import('../../lib/interactive-html-client');
        if (!root.isConnected) return;
        this.instance?.destroy();
        const card = createInteractiveCard(options); stage.replaceChildren(card);
        this.instance = mountInteractiveCard(card, true); this.instance?.run();
        preview.textContent = '更新预览';
      } catch (error) { label.textContent = `预览失败：${(error as Error).message}`; }
      finally { preview.disabled = false; }
    };
    return root;
  }
  destroy() { this.instance?.destroy(); }
  ignoreEvent() { return true; }
}
