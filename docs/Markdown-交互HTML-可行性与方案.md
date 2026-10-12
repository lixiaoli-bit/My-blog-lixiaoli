# Markdown 交互 HTML 扩展：可行性与方案

研究日期：2026-10-11。本文保留前期研究和原型记录；产品功能与便携版 2 已实现并通过隔离验收，当前交付状态见 [使用与验收](./Markdown-交互HTML-使用与验收.md)。云端部署另行安排。

## 1. 结论

可行。建议增加专用 `html-interactive` 代码围栏，用现有 `renderMdx` 管线识别，再在带沙箱的 iframe 中运行 HTML、CSS 和 JavaScript。适合算法动画、公式参数滑块、结构示意图、选择题、小型计算器等学习工具。

正文继续保存 Markdown 原文，不需要引入 React 项目、构建工具或新数据库表。第一版只支持自包含页面；它能运行前端逻辑，不能直接运行 Node.js、Python、C 程序或替代有后端服务的完整网站。

这里的“可行”指嵌入交互页面的机制得到验证，不代表任意 AI 生成脚本都经过安全审计，也不代表桌面端、线上部署与复杂页面已通过验收。

## 2. 当前项目的接入条件

| 当前实现 | 对新功能的影响 |
| --- | --- |
| `src/lib/mdx.ts` 使用 MDX evaluate 和 React SSR，最终输出 HTML 字符串 | 原始 HTML/JS 应保留为围栏数据，不能作为 MDX 表达式或服务端执行代码 |
| `src/lib/mdx-plugins.ts` 已维护 remark 插件数组，组件注册表在 `src/components/mdx/registry.tsx` | 可新增一个围栏转换插件和展示组件，复用现有管线 |
| 代码围栏在多项源码规范化中有保护；现有 `html` 围栏显示代码 | 采用新语言名，不改变普通 HTML 示例的行为；需补齐特殊字符原样性测试 |
| `src/pages/doc/[id].astro` 切文章、刷新预览时通过 innerHTML 更新正文，阅读区域会发 `article:body-updated` | iframe 生命周期必须覆盖 SSR 首屏、页内切换、编辑预览、Astro 导航和卸载 |
| 思维导图名称的渲染结果通过 DOMPurify，明确禁止 script、iframe、object、embed、form | 不放宽这条清洗规则；节点展示交互块入口，点击后由受控组件启动隔离预览 |
| `src/lib/mdx/source-blocks.ts` 已采集文章块来源 | 交互块应作为一个完整来源单位保留 key、稳定块 ID、标题和摘要，不把脚本细节当作知识节点 |
| Electron 主窗口使用 nodeIntegration:false、contextIsolation:true，但启动代码带 no-sandbox | 页面级沙箱仍有价值，进程级沙箱未启用需要明确处理和单独验收 |

MDX 官方支持通过 remark/rehype 插件和组件扩展渲染，这与本项目现有架构匹配：[Extending MDX](https://mdxjs.com/docs/extending-mdx/)。

## 3. 建议语法

````markdown
```html-interactive id="counter-demo" title="计数器演示" height="320"
<style>
  body { font-family: system-ui; padding: 16px; }
  button { padding: 8px 16px; }
</style>

<button id="increment">点击加一</button>
<output id="count">0</output>

<script>
  let count = 0;
  document.getElementById('increment').addEventListener('click', () => {
    document.getElementById('count').textContent = String(++count);
  });
</script>
```
````

- `html-interactive` 是明确的执行选择；`html` 仍然是普通代码块。
- `title` 用于卡片标题、iframe 无障碍名称和思维导图摘要。
- `id` 为可选的文章内唯一标识。第一版用于稳定定位；后续用于独立的学习状态保存，不能替代服务端来源身份校验。
- `height` 是初始高度，不代表最终高度。默认高度和自动测量有上、下限；超长页面使用内部滚动。
- 第一版可接受 HTML 片段和完整 HTML 文件。完整文件需用 HTML 解析器规范化，注入策略和桥接脚本，避免依赖字符串拼接或正则处理 head/body。
- 内容不再按 Markdown 解析；JavaScript 中的花括号、反引号、比较符和公式字符串必须原样保留。
- 需要在内部展示三反引号时，外层围栏可用四个或更多反引号。
- 参数只接受固定白名单和类型；不开放自定义 sandbox、任意来源 URL 或 JavaScript 表达式参数。

不建议第一版再增加功能相同的 `:::html` 语法，避免两套解析与编辑规则。代码围栏本身可以保护完整 HTML/JS，也方便在源码模式复制粘贴。

## 4. 产品行为与 UI

继续沿用扁平化与新粗野主义：暖白底、深色边框、硬阴影、橙色运行按钮，支持明暗主题。

建议外层卡片为：标题 + “运行 / 重新运行 / 放大 / 查看源码”。内容区提供加载中、运行结果、运行失败三种状态。文章阅读区域先出现卡片，进入视野后初始化，复杂内容可点击运行；源码模式始终编辑原文。

编辑过程不在每次键入时执行脚本。编辑预览先展示待运行卡片，点击运行或更新后才重建 iframe，避免频繁重置、抢焦点或重复启动动画。错误包含摘要与可展开日志，不应让整篇文章渲染失败。

“放大”由博客外层 UI 扩大同一个 iframe 容器，以尽量保留当前运行状态。不要把裸 HTML 在博客同源新窗口打开；如果使用独立预览窗口，仍需套上隔离容器，且明确可能重新运行。

文章中的标题折叠、Callout、Tabs 和多栏容器可以容纳交互块。隐藏时尽量暂停动画，重新显示后重新测量高度；切文章时销毁实例和事件监听。主题变化通过限定的消息发送主题值与设计变量，避免 iframe 读取父页面样式。

思维导图建议显示标题、交互类型和“打开演示”按钮。交互页面进入大图预览；不在每个节点中常驻运行 iframe，避免大量动画、动态尺寸和画布拖动产生冲突。PNG/SVG/PDF 导出提供静态摘要或后续截图能力，不承诺导出文件保留交互。

## 5. 隔离与权限设计

建议第一版使用 `iframe sandbox="allow-scripts"`，不加 `allow-same-origin`、顶层导航、弹窗、下载、表单提交权限。表单输入和本地事件仍可使用，但真实提交被限制。MDN 明确指出，不使用 allow-same-origin 会让 iframe 处于特殊来源，限制它访问 Cookie、存储等；同源 iframe 同时使用 allow-scripts 与 allow-same-origin 会削弱隔离：[iframe 文档](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)。

使用 srcdoc 时由组件属性或 DOM API 赋值，HTML 源码作为转义的数据传递；禁止把内容直接拼入父页面 script 标签。HTML 包装由受控解析器完成，先插入 CSP，再接入用户内容，避免用户提供的 base、刷新跳转、嵌套页面等改变运行入口。

默认策略只允许内联脚本、内联样式与必要的内嵌图片；拒绝网络连接、外部脚本、对象、嵌套框架和表单提交。例如原型使用：

```text
default-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data:;
connect-src 'none';
form-action 'none';
base-uri 'none';
frame-src 'none';
object-src 'none';
```

这里的 unsafe-inline 只用于隔离运行页，不应放宽博客父页面的策略。srcdoc 的实际执行还受父页面 CSP 影响；部署到 Vercel 后需要验证策略组合，不能靠子页面 meta 放松父页面限制。后续如果需要联网加载库，优先使用专用隔离来源和经过版本固定的资源白名单。

父子通信只开放高度、主题、运行状态和受限错误信息。接收端必须校验具体的 `event.source`、当前实例标识、加载版本、消息类型及字段大小；特殊来源可能是 `null`，不能仅以 origin 等于 null 作为信任依据。限制高度范围、变化阈值和消息频率，避免自适应高度循环或刷消息拖慢正文。[postMessage 文档](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns)

沙箱不是权限系统，不能单靠它防止所有网络行为或资源耗尽。页面自导航、链接、资源请求、异常输出、死循环仍需专门测试。父页面重置按钮对占满主线程的恶意脚本不一定及时有效；浏览器沙箱也不保证 CPU/内存配额。第一版定位为站主编写的学习演示，不开放给访客上传并执行任意脚本。

文章密码、私有文档与站主权限应复用现有检查。第一版将内容保留在正文，可减少额外公开 HTML 地址的泄露面；如果后续增加 HTML 附件或预览接口，它们需要独立检查来源权限与缓存策略，不能仅在文章页面检查。

桌面端的 iframe 不能获得 window.desktop、Node、文件系统或任意 IPC。现有部分原生操作已检查 senderFrame 与页面路径，新运行场景仍应审查全部桥接通道、子框架导航与下载。Electron 官方提醒子框架可能发送 IPC，要求校验来源：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)。当前 no-sandbox 参数关闭进程隔离，应先调查其兼容性原因并在真实设备验证修复或适用边界；本轮研究没有修改这些参数。

## 6. 数据保存、离线与外部页面

第一版保存 HTML 源码，运行过程状态留在 iframe 内存中，重新运行后重置。无外部资源的小工具可以离线使用；如果 HTML 依赖 CDN、远程图片或服务，则不能承诺离线可用。

如果需要保存做题进度，可在第二版加入受控状态桥：按文章身份、稳定块 ID、内容版本和用户身份隔离，只接收限量 JSON 数据，并验证访问权限与冲突。不要通过开放 allow-same-origin 让小工具直接使用博客 localStorage、Cookie 或 API。

完整网站链接与自包含 HTML 是两种能力。外部网站可能使用 X-Frame-Options 或 CSP frame-ancestors 禁止嵌入；只有站点允许时才可提供 iframe，不能承诺任何 URL 都能显示。[MDN frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)

第一版优先“粘贴源码”。后续可增加“导入 HTML 文件”，将文件内容作为原文纳入文章，或使用有权限保护的附件存储。相对路径图片、JS、CSS 与多文件网页需要资源打包/映射方案，不能直接把本机文件路径写进文章。

## 7. 实验结果与局限

隔离原型：`outputs/html-interactive-research/probe.ts`。

执行命令：`pnpm exec tsx outputs/html-interactive-research/probe.ts`。结果：6 项通过，输出 `outputs/html-interactive-research/result.json`。

1. 现有 renderMdx 将 HTML 围栏作为源码展示，不自动执行。
2. 原型 AST 插件能读取完整内容；测试中的 JavaScript 花括号、比较符、公式标记与指令保持原样。
3. AST 插件接入现有插件与组件管线后，文章中的普通公式仍渲染为 KaTeX。
4. Edge 沙箱 iframe 中脚本可运行；父页面 DOM、Cookie、localStorage 读取被阻止；connect-src:none 阻止测试请求，隔离 HTTP 服务未收到该请求。
5. 按钮连续点击正常，校验消息来源后可调整框架高度。
6. 390px 宽度下，容器使用 border-box 后无横向溢出。

测试使用临时 127.0.0.1 HTTP 服务和新启动的无头 Edge，不连接博客数据库，不替换运行中的桌面客户端。

局限：浏览器原型不是完整生产插件；没有测试真实 Electron preload、Vercel 父页面 CSP、全部导航/弹窗行为、恶意资源耗尽、嵌套扩展语法、编辑器实时预览和图像导出。浏览器测试中的 window.desktop 为 undefined 不能作为 Electron 隔离的验证结论。

## 8. 建议实施顺序和验收

| 阶段 | 工作 | 验收要求 |
| --- | --- | --- |
| 1 | 围栏 AST 插件、参数校验、统一组件、原文传递、沙箱运行 | 普通 html 代码不受影响；特殊字符不改写；正文无脚本执行；连续按钮交互正常 |
| 2 | 文章/文档首屏与动态切换、预览手动运行、源码编辑、重置/放大/错误显示 | 切文章不残留实例；编辑不反复执行；折叠、Tabs、多栏、390px 和明暗模式通过 |
| 3 | 稳定来源索引、思维导图入口、导出降级、HTML 文件导入 | 导图可定位原文；不放宽节点 DOM 清洗；HTML 原文和 JSON 导入导出可往返 |
| 4 | 浏览器、Vercel 与 Electron 单独验收 | 权限与密码门禁、桥接、网络阻断、导航限制、CSP、实例销毁和性能边界通过 |
| 后续 | 固定版本资源包、受控状态保存、统一 AI 生成规范 | 离线依赖完整；状态按来源/版本/用户隔离；AI 不生成任意博客 API 调用 |

不需要现在升级到另一套 Markdown 引擎。第一版主要工作在渲染扩展、客户端生命周期与隔离策略，复杂度中等；引入外部资源、跨端持久化与任意网页嵌入会明显增加工作量，应分开验收。
