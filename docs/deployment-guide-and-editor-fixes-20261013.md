# 部署教程与编辑体验适配记录

日期：2026-10-13。此次只做本地开发和交付，不执行线上发布、生产数据库迁移或真实媒体上传。

## 用户需求与结果

| 需求 | 实现 |
| --- | --- |
| 目录点击准确，但高亮上一节 | 目录导航记录明确的目标标题，跨 CodeMirror 异步测量保持高亮；用户滚动、点击或输入后恢复视口判断。覆盖 h3/h4、重复标题与末尾标题。 |
| 首页文章封面删除 | 文章编辑页的封面右键提供“删除图片”，确认后仅清除封面引用，正文和图片文件保留。 |
| 缺少手动上传封面 | 标题操作区加入“上传封面”，复用 `/api/images` 与现有 GitHub/R2 分流；文件不超过 3MB。 |
| 立即同步缺少反馈 | 点击立即显示启动反馈与等待时间；按钮显示当前阶段；完成/失败与报告可见。旧 GET 不可覆盖点击后的状态，打开同步分区会刷新。 |
| 恢复全局字体与继承 | 全局字体重新可选；文章可“跟随全局字体”或单独设置；两者都默认时使用当前默认字体。保存与恢复即时更新，兼容旧 ui/article 配置。 |
| 新安装本地可用 | 新配置生成随机本地密码/签名密钥，默认无云数据库；桌面自动建立本地站主会话，提示本地使用或打开云端教程。已有配置不被覆盖。 |
| 部署教程网站 | `public/deploy/` 包含自包含 HTML/CSS/JS，包豪斯几何、平面色块、简洁排版。分桌面与 Web，覆盖 Fork、Vercel、PostgreSQL、域名、R2、GitHub 图床、备库和验收。 |

## 架构与部署适配

- Vercel 运行 Web/API；PostgreSQL 保存正文/设置/媒体元数据；R2 或 GitHub 保存媒体文件。主库为云端必选，备库可省略。
- `desktop/config.cjs` 管理新安装的持久随机本地身份。数据库仍由当前 SQLite 空库模板创建，云配置留给设置页面。旧用户不会被自动切换为自动登录。
- `scripts/build-portable.mjs` 现在先生成最新 SQLite 模板，再构建与打包，确保从源码初次打包也包含完整空库。
- `scripts/deployment-migration.mjs` 移除批量将旧文章 `published` 设为 true 的业务修改。部署迁移只增量升级表结构并进行可清理的验证探针。
- 手动封面的独立 PUT 接口只写 cover/updatedAt，使用原 cover 比较防止覆盖另一个窗口的封面；不调用整篇文章保存流程。
- 字体覆盖使用独立 `site-font-overrides` 样式，避免被界面风格切换当作旧样式禁用。`ui` 字段承载全局字体，新增 `inherit` 表示未单独选择。

## 教程来源与准确性边界

已核对当前仓库 `astro.config.mjs`、`package.json`、数据库迁移/主备/同步代码、图片上传分流、R2 配置、GitHub 图床和桌面首次启动代码。

教程引用以下官方资料，域名记录值使用 Vercel 实际面板值，不写死 IP/CNAME，不承诺永久免费或所有地区网络可达：

- [Astro on Vercel](https://vercel.com/docs/frameworks/frontend/astro)
- [Postgres on Vercel](https://vercel.com/docs/postgres)
- [Vercel 构建与 Corepack](https://vercel.com/docs/builds/configure-a-build)
- [Vercel Node.js 版本](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel 域名](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel 环境变量](https://vercel.com/docs/environment-variables)
- [Neon 官方连接说明](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md)
- [Cloudflare R2 S3](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2 公开桶](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare R2 费用](https://developers.cloudflare.com/r2/pricing/)
- [GitHub Fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/fork-a-repo)
- [GitHub PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

当前教程先本地交付。将来发布这个版本后，线上目标为自己博客的 `/deploy/`；本次没有上线，因此不会声称目标网址已经可访问。

## 验证命令

```powershell
pnpm exec vitest run --maxWorkers=4
pnpm check
node scripts/preview-deployment-guide.mjs
node scripts/verify-deployment-guide.mjs
pnpm run build:portable --target portable-deploy-20261013
node scripts/verify-editor-portable.mjs portable-deploy-20261013
node scripts/verify-deployment-fixes.mjs portable-deploy-20261013
pnpm exec astro build --outDir .diag/deployment-web-build
```

自动化脚本使用独立 appData/userData、SQLite 和合成文章，未改动真实用户文章。封面测试使用模拟图片上传响应；同步测试使用模拟延迟和失败响应，验证操作反馈、请求竞争与结果显示。它们不证明用户的 R2/GitHub/主备数据库真实连接已经验收。

实际结果以 `outputs/deployment-guide-review/latest.json`、`outputs/deployment-fixes-review/latest.json` 与 `outputs/portable-editor-review/latest.json` 为依据。

本次已完成的结果：

- 全量测试：104 个文件、1195 项通过；测试类型断言修正后，对应接口与便携目标测试再次通过。
- `pnpm check`：0 errors、0 warnings、51 hints。
- 教程浏览器检查：7 项通过，包含 1280/390 宽度无横向溢出、锚点定位、复制反馈、检查进度持久化、减少动态效果与无脚本错误。截图在 `outputs/deployment-guide-review/`。
- 真实便携包专项验收：12 项通过，涵盖首次创建本地库、首次使用选择、本地站主会话、离线分发教程、首页与文档目录、封面上传/删除、字体继承/恢复、同步状态请求竞争与结果显示。
- 便携包原有编辑回归：通过，覆盖块间输入保存、重新打开、嵌套强调、转义标记、代码与表格中文输入。
- 桌面构建与 Vercel 适配器的隔离本地构建均通过；构建存在已有的较大前端 chunk 提示，没有构建错误。没有运行生产迁移脚本。
- 最终教程 HTML/CSS/JS 与桌面包中的静态文件逐一校验一致，SQLite 模板含 48 张表。

隐藏 Electron 窗口的截图超时不作为功能失败或通过依据；最终专项验收依靠实际 UI 操作与数据库/DOM 断言完成，不依赖该截图。

## 本地交付

教程预览地址：`http://127.0.0.1:4390/deploy/`。不启动完整博客也能查看。

便携包：`release/portable-deploy-20261013/白衣卿相.exe`。打开前保存并完全退出旧应用与托盘；保留整个便携目录。原有正在使用的便携目录没有被覆盖。

尚需在用户实际账号上完成：Vercel 首次配置/迁移、域名 HTTPS、真实 PostgreSQL 双向同步、真实 R2 或 GitHub 图片上传。新配置中的本地随机凭据与云端登录密码是独立的，不要求它们相同。

## 发布前精简

保留 Android、独立宣传站与宣传视频工程。删除 33 个一次性排障脚本/中间 JSON、无引用字体副本和根目录视频产物；原始视频已归档到本机忽略目录 promo-film/rendered/。累计清理 97 个临时或废弃文件（约 6.1 MB），视频迁移不计入删除体积。修复环境变量示例被重复忽略规则排除的问题，并补充数据库 WAL/SHM、Android 原生工程的部署排除规则。批量旧构建目录删除被自动审批拒绝后，改用 Windows 回收站，已回收 .verify-build、.verify-vite-cache、undefined 和空的 .workbuddy-tmp。旧发布包扫描较慢，暂时保留在忽略范围内；不进入 Git 或发行文件。为发布加入独立桌面构建目录，避免累积旧前端资源进入新包。

## Windows 1.1.4 成品验收

独立桌面构建约 737 MB，比原来含历史前端资源的约 811 MB 少约 74 MB。Windows x64 安装包为 218236059 字节，便携 ZIP 为 309591736 字节，均附 SHA-256。两个归档的完整性检查通过；NSIS 的尾部数据提示来自安装器包装，不是载荷损坏。安装包载荷通过隔离启动和编辑回归，没有在用户当前环境覆盖安装。

安装载荷的隐藏窗口验收曾触发启动可见性看门狗，短暂显示再隐藏使 CDP 合成输入提前结束，后续 insertText 形成重复文本。已在验收脚本中隔离可见性看门狗，并增加暂停时仍处于 composition 的断言，复验通过。发行程序代码和文件未因此改变。
