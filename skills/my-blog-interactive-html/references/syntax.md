# 语法与运行契约

````markdown
```html-interactive id="counter-demo" title="计数器演示" height="360"
<button onclick="this.textContent = Number(this.textContent) + 1">0</button>
```
````

`title` 可省略，默认“交互演示”，最多 200 字；`id` 可省略，以字母开头，最多 80 个字母、数字、下划线或短横线，同文章不能重复；`height` 是 200～960 的整数，默认 360。未知参数会显示当前卡片的错误，不中断文章。普通 `html` 围栏只展示代码。

完整文档和片段均可。粘贴源码保持 HTML 原样，勿把 `{}`、比较运算符、反引号和公式字符串改写成 Markdown 转义。包含三反引号时用四个或更多反引号作外层围栏。

阅读页进入视野后首次运行；编辑预览需点击运行。放大保留同一实例状态，重新运行会重置状态。离开文章后释放实例。自动高度限制 200～960px，超出内部滚动；布局不要绑定父窗口高度制造测量循环。

只允许内嵌脚本、样式和 data URL 图片/媒体。外部脚本、样式、相对资源、fetch、WebSocket、Worker、iframe、对象、表单提交受限。无法承诺阻止任意脚本的 CPU 或内存耗尽。不要依赖 eval、动态 import、存储、原生桥接或页面导航。

宿主设置 `html[data-theme]` 并提供 `--paper`、`--ink`、`--accent`；练习应使用这些变量。可监听 `byqx:visibility` 的 `event.detail.visible` 暂停计时器；不要自行发送宿主协议消息。

思维导图中的演示是静态入口，点击打开独立大图交互。重命名不改变来源。PNG、SVG、大纲只是静态说明；JSON 保留源码或真实来源，引用仍依赖原文章可访问。
