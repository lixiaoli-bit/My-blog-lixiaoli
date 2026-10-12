# Markdown 交互 HTML

## 编写

````markdown
```html-interactive id="counter-demo" title="计数器演示" height="360"
<p>点击按钮：</p>
<button onclick="this.textContent = Number(this.textContent) + 1">0</button>
```
````

支持自包含 HTML 片段或完整文档。普通 `html` 围栏仍只展示代码。原始内容保存在正文或导图节点名称里，运行状态只在当前实例内存中保留。

参数仅支持 `id`、`title`、`height`。id 可选，以字母开头，最多 80 个字母、数字、下划线或短横线，同文章不能重复。标题默认“交互演示”，最多 200 字；初始高度默认 360，范围 200～960。单块 UTF-8 大小最多 256 KiB，文章和导图节点仍沿用原有大小限制。

阅读页的可见卡片自动运行，隐藏的 Tabs、折叠卡片展开后才启动。滚出视野保留状态并通知页面隐藏；需要暂停动画的演示监听 `byqx:visibility`。放大复用原 iframe，Esc 还原；重新运行重置状态。文章切换和页面离开释放实例。

编辑器的插入菜单提供“交互 HTML”及“导入 HTML”。选择 UTF-8 `.html`/`.htm` 单文件，插入到当前光标，整次撤销，不覆盖正文。文件含较长反引号时自动延长外层围栏。编辑预览需手动点击运行，新源码不会擅自刷新正在操作的预览。

## 导图与生成技能

演示块进入文章内容索引，以标题归属章节。拖入或加入导图的引用节点显示“打开演示”，点击大图交互；原文跳转继续独立。节点重命名支持 Markdown，并保留原文身份。直接把围栏写入节点名称也支持演示入口，遵守 10,000 字节点上限。

JSON 保留源围栏或来源引用；后者仍需原文章可访问。PNG、SVG、大纲为静态说明，不打包执行页面。

技能源码位于 `skills/my-blog-interactive-html`，可直接分发整个文件夹。技能生成 UTF-8 HTML 及 Markdown，提供计数器、冒泡排序与平方函数示例。使用 `node skills/my-blog-interactive-html/scripts/validate.mjs 页面.html [输出.md]` 做静态检查与围栏生成；浏览器运行和教学内容需要另行核对。

## 隔离边界

演示运行于 `iframe sandbox="allow-scripts"` 的特殊来源，受控文档前置 CSP。仅允许内嵌脚本、样式和 data URL 图片/媒体；不开放同源、联网接口、嵌套页面、弹窗、下载、表单提交和原生桥接。运行错误只反馈当前卡片。

服务端只解析、存储和转义源码，不执行脚本。运行文档用既有 HTML AST 解析器构建。父页面消息校验 iframe、随机实例 token、类型、有限高度、错误长度和消息速率。浏览器页面发生自导航后终止该实例；Electron 在导航前拦截并终止。第一版无法承诺阻止恶意脚本占满 CPU/内存，不应运行无法信任的来源。

Electron 全局启用进程沙箱并移除关闭沙箱的开关，preload 仅向主框架暴露桥接；所有原生 IPC 检查受信任主框架。参考 [Electron 进程沙箱](https://www.electronjs.org/docs/latest/tutorial/sandbox) 与 [IPC 来源验证](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)。

## 验收命令

- `pnpm exec vitest run tests/interactive-html.test.ts tests/mdx.test.ts tests/mdx-concurrency.test.ts tests/markdown-visual-directives.test.ts tests/mindmap-structure.test.ts tests/article-mindmap.test.ts`
- `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`：当前 TypeScript 6 配置需要显式忽略既有 baseUrl 弃用提示。
- `pnpm run build:desktop`：直接 Astro Node 构建，跳过真实云库迁移。
- `node scripts/test-interactive-html-browser.mjs`：真实构建路由、隔离 SQLite、Edge。
- `node scripts/test-interactive-html-browser.mjs --desktop`：隔离数据库与配置，真实本机 Electron，启用沙箱。
- `BYQX_DESKTOP_BUNDLE_DIR=portable2 node scripts/test-interactive-html-browser.mjs --desktop`：对指定的空闲便携包验收（PowerShell 用 `$env:BYQX_DESKTOP_BUNDLE_DIR='portable2'`）。

报告与截图保存在 `outputs/interactive-html/<运行类型>-<时间戳>/`。不读取或修改用户业务库，不自动云发布，不构建 Android。

## 本轮交付记录（2026-10-11）

- 6 组针对性测试共 194 项通过，类型检查通过，直接 Astro Node 构建及便携包构建成功。
- Edge 验收报告：`outputs/interactive-html/browser-1791726275990/report.json`，13 组检查通过。
- 实际便携版 2 验收报告：`outputs/interactive-html/desktop-1791726593223/report.json`，14 组检查通过。使用便携包目录之外的独立运行目录、隔离配置及数据库；进程沙箱开启，未使用关闭沙箱的开关。
- 验证内容包含连续按钮操作、放大/Esc/重置、源码查看、明暗模式、1440/1024/390px、隐藏 Tabs/折叠、手动编辑预览、文件导入撤销、文章切换清理、嵌套演示引用、静态 PNG/SVG/大纲及 JSON 再导入。计数器、排序单步和公式滑块三个技能示例均实际运行通过。
- 交付目录：`release/portable2`，入口 `白衣卿相.exe`。保持原 `release/portable` 学习客户端运行；使用时保留整个便携目录。
- 技能已安装到 `C:/Users/a3129/.codex/skills/my-blog-interactive-html`，分发包为 `outputs/skills/my-blog-interactive-html.zip`。既有 `my-blog-mindmap-json` 规范已补充演示标题、来源引用与静态导出规则。

尚未部署或验收云端 Vercel 环境，未构建 Android。任意来源的复杂脚本、资源耗尽与用户全部既有文章不在上述通过结论内；技能教学内容仍需使用者核对。
