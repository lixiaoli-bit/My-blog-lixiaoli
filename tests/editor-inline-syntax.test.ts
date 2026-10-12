import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { livePreview } from '../src/components/admin/cm-live-preview';
import { wysiwygPreview } from '../src/components/admin/cm-wysiwyg';
import { visualDirectivesExtension } from '../src/components/admin/cm-visual-directives';

for (const [name, extension] of [['live', livePreview()], ['wysiwyg', wysiwygPreview()]] as const) {
  describe(`${name} 标准行内语法`, () => {
    const inspect = (source: string) => {
      const doc = `${source}\n\n尾部`;
      const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: extension });
      const set = state.facet(EditorView.decorations)[0] as DecorationSet;
      const hidden: Array<[number, number]> = [];
      const marks: Array<{ from: number; to: number; class: string }> = [];
      for (const cursor = set.iter(); cursor.value; cursor.next()) {
        if (cursor.value.spec.class) marks.push({ from: cursor.from, to: cursor.to, class: cursor.value.spec.class });
        else if (!cursor.value.spec.widget && cursor.to > cursor.from) hidden.push([cursor.from, cursor.to]);
      }
      const text = [...source].filter((_, i) => !hidden.some(([from, to]) => i >= from && i < to)).join('');
      return { text, marks, state, set };
    };
    it('嵌套强调保留内外格式且没有残留星号', () => {
      const result = inspect('**粗体内的 *斜体* 内容**');
      expect(result.text).toBe('粗体内的 斜体 内容');
      expect(result.marks.map(m => m.class)).toEqual(expect.arrayContaining(['cm-lp-strong', 'cm-lp-em']));
    });
    it('转义星号保留字面文本且不产生斜体', () => {
      const result = inspect(String.raw`\*不是斜体\*`);
      expect(result.text).toBe('*不是斜体*');
      expect(result.marks.some(m => m.class === 'cm-lp-em')).toBe(false);
    });
    it('多反引号代码保留内部反引号，代码内格式不执行', () => {
      const result = inspect('``a ` **b**``');
      expect(result.text).toBe('a ` **b**');
      expect(result.marks.map(m => m.class)).toEqual(['cm-lp-inline-code']);
    });
    it('下划线与三重强调遵循 Markdown 语法', () => {
      expect(inspect('_斜体_ __粗体__ ***两种***').text).toBe('斜体 粗体 两种');
      expect(inspect('a_b_c 未闭合 **正文').text).toBe('a_b_c 未闭合 **正文');
    });
    it('源码回显与离开恢复不修改文档，普通光标移动复用装饰', () => {
      const result = inspect('开头 **粗体内的 *斜体* 内容** 结尾');
      const next = result.state.update({ selection: { anchor: result.state.doc.length - 1 } }).state;
      expect(next.facet(EditorView.decorations)[0]).toBe(result.set);
      const inside = result.state.update({ selection: { anchor: result.state.doc.toString().indexOf('斜体') } }).state;
      expect((inside.facet(EditorView.decorations)[0] as DecorationSet).size).toBeLessThan(result.set.size);
      expect(inside.doc).toBe(result.state.doc);
    });
    it('跨行代码内的链接与格式保持字面文本', () => {
      const result = inspect('``代码\n[链接](https://example.com) **正文**``');
      expect(result.text).toBe('代码\n[链接](https://example.com) **正文**');
      expect(result.marks.every(m => m.class === 'cm-lp-inline-code')).toBe(true);
    });
    it('删除线及连续反斜杠转义保持正确边界', () => {
      expect(inspect('~~删除~~').text).toBe('删除');
      expect(inspect(String.raw`\\*斜体*`).text).toBe('\\斜体');
    });
  });
}

it('独立可视指令编辑器可以初始化 Tabs，不依赖文章宿主安装其它块扩展', () => {
  const state = EditorState.create({ doc: ':::tabs\n\n@tab 第一项\n\n正文\n\n@tab 第二项\n\n内容\n\n:::', extensions: visualDirectivesExtension() });
  expect((state.facet(EditorView.decorations)[0] as DecorationSet).size).toBe(1);
});
