# 文档源码与导图 JSON 工作流

文档文章标题旁提供「预览／编辑／思维导图／源码模式」。预览是渲染后的文章，编辑保留所见即所得，源码模式显示完整 Markdown 标记及行号；模式切换复用同一个编辑器，保留输入与撤销记录，继续自动保存。点击预览先完成保存；失败时留在编辑器。

## 交给 AI 的素材

进入源码模式可复制源码，或点击「下载导图素材」。下载会先保存正文与标题，再取得当前文章的稳定内容块索引，输出 `*-导图素材.json`：

```text
format = byqx-mindmap-source
version = 1
source = domain / targetId / title / contentHash
markdown = 完整正文源码
blocks = 真实标题、卡片与引用块索引
```

素材文件包含全文及来源，只用于本地 AI 输入，不能直接当作导图导入。文章改动后应重新下载，保留新的块身份与内容指纹。

## 三个技能的分工

- `note-normalizer`：判断笔记类型、整理原文；My-Blog 目标增加标题层级、卡片归属和重复索引检查。
- `my-blog-structured-notes`：生成完整结构化 Markdown，保留题干、解析、事实与复习模板；增加第 15 节导图兼容约束。
- `my-blog-mindmap-json`：分析全文，生成简洁导图 MapDocument JSON；有真实素材则绑定来源，只有 Markdown 则生成无跳转结构。

示例指令：

```text
使用 $my-blog-mindmap-json，将这份导图素材转换为可导入 My-Blog 的 JSON。
逻辑图布局，保留所有真实小节和卡片；名称简短，公式用行内 Markdown，
完整题干与解析留在文章中。不要重复章节或将复习索引再次展开为完整知识树。
```

新技能安装于 `C:/Users/a3129/.codex/skills/my-blog-mindmap-json/`，包含 JSON 契约、排版规则和零依赖校验脚本。两份原技能仍位于用户指定的 `C:/Users/a3129/.agents/skills/`，增加共享兼容参考；修正了强化讲义“题干卡＋解析卡”与单张题卡模板的矛盾。

## 导入与核对

先运行：

```powershell
node C:/Users/a3129/.codex/skills/my-blog-mindmap-json/scripts/validate_json.mjs 导图.json 导图素材.json
```

在关联文章中打开思维导图，选择「导出 → 导入 JSON」。导入之前会下载当前图的备份；它替换整个导图数据，请保留备份。JSON 顶层直接包含 `root`，不能包在 `map`、`data`、`nodes` 中，也不能导入素材文件。

检查一篇只有一个文章根、每个真实章/节只出现一次、卡片归属正确、不同来源的同名卡片未误合并，点击节点右侧图标定位原文。JSON 结构校验、Markdown 名称渲染、实际画布排版和知识内容准确性分别核对。

该工作流不自动发布文章、覆盖真实导图或调用付费模型。按需使用已配置 AI 或外部 AI 编写文件，再由用户导入。

## 本轮验证（2026-10-11）

- 源码模式的 6 组生产浏览器验收通过：完整标记与行号、切换及撤销/重做、保存后预览、完整素材下载、校验器正反例、真实 JSON 导入/备份/公式/跳转、390px 与访客权限。
- 编辑器相关 6 个测试文件共 83 项通过，包含保存后预取失效与迟到响应保护；导图和 Markdown 相关 7 个文件共 271 项通过。
- Astro 类型检查 0 errors / 0 warnings；使用隔离数据库执行桌面构建，没有运行会迁移真实数据库的总构建命令。
- Electron 源构建的 31 项验收通过，新增源码模式与原生下载完整导图素材；两份现有 skill 和新 JSON skill 均通过技能格式校验。

证据：`outputs/doc-source/browser.json`、`skill-validation.log`、`desktop-source.json`、`doc-source-editor-unit.log`、`doc-source-typecheck-final.log`、`doc-source-build-final.log`。样例图与素材仅来自隔离测试文章。真实文章的知识提炼质量需在 AI 产出后核对；本轮模型接口使用隔离回复，未调用真实订阅模型。

用户确认“已保存并完全退出”后，检查原程序进程已退出并覆盖固定 `release/portable`。实际打包程序从项目外启动，以独立配置和数据库完成 31 项验收，页面异常为 0；1,746 个 dist / desktop 文件与最终源构建一致，服务器入口按便携运行路径补丁核对。证据为 `outputs/doc-source/desktop-packaged.json`、`payload-verification.json` 及 `outputs/doc-source-package.log`。最终入口 `release/portable/白衣卿相.exe`，必须保留完整 portable 文件夹。
