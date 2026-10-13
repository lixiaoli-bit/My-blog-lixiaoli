# Windows 桌面端

桌面端与 Web 共用页面、编辑器和数据层。Web 默认使用 Vercel 和 PostgreSQL；Windows 桌面端使用 Electron、本地 Astro 服务和 SQLite。当前正式发行仅包含 Windows x64。

## 使用与数据

从 [GitHub Releases](https://github.com/shijing-lu/My-blog/releases/latest) 下载安装包，或下载便携 ZIP 后完整解压，再运行 `白衣卿相.exe`。便携版必须保留整个目录及 `resources`。

首次启动自动创建本地数据库和配置，并提供“本地使用”和“查看云端部署教程”。本地使用不需要云端账户；云端数据库、R2 和 GitHub 图床可在设置中配置。详细教程见项目内 `/deploy/`，本地预览：`node scripts/preview-deployment-guide.mjs`。

用户数据位于 `%APPDATA%\\byqx-blog-desktop\\`：

- `config.json`：本地及云端配置。已有配置升级时保留。
- `blog-local.db`：本地文章、设置和同步记录。
- `files/`：对象缓存。
- `logs/launch.log`：启动及同步日志。

升级前保存文章并通过托盘退出旧版，再安装新版或打开新便携目录。排障前备份上述目录；不要为解决空白页直接删除用户数据库。

## 构建和验证

需要 Node.js 24.19+、项目指定版本的 pnpm，以及 Windows x64 环境。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
# 自动生成空库模板，构建并组装到未运行的目录
$env:BYQX_DESKTOP_DIST_DIR = '.diag/windows-release-dist'
pnpm run build:portable -- --target windows-release
node scripts/verify-editor-portable.mjs windows-release
node scripts/verify-deployment-fixes.mjs windows-release
```

独立构建目录必须位于项目 `.diag/` 内。新包从独立产物复制，避免历史哈希资源累积；正在运行的便携目录会被保护。日常默认构建仍输出 `dist/`。

NSIS 安装包使用根目录 `desktop-builder.yml`。它可从已验证的便携目录制作：复制为新的 `win-unpacked` 目录，移除复制品的 `resources/desktop-assets/portable.marker`，再运行：

```powershell
pnpm exec electron-builder --win nsis --x64 --prepackaged release/win-unpacked --config desktop-builder.yml --publish never
```

发布前更新 `package.json` 与 `public/desktop-version.json` 的版本，验证安装包及便携包，将 Windows 文件和 SHA-256 校验表上传到 GitHub Release。源码的 Android、宣传站与宣传视频工程继续保留，它们不进入 Windows Release。

`.github/workflows/windows-release.yml` 可在 GitHub 的 Actions → Windows Release 中输入已有版本标签后运行；后续 `v*` 标签也会触发。流程在 Windows 上安装锁定依赖、检查代码、测试、生成空库和桌面包、验证实际程序，最后以仓库自带的临时令牌上传 Windows 安装包、便携 ZIP 及校验表。已发布的同名 Release 不会被覆盖。构建阶段不注入发布令牌，不需要本机上传大文件，也不需要新增个人访问令牌。

## 开发入口

- `desktop/main.cjs`：窗口、托盘、认证和同步触发。
- `desktop/config.cjs`：首次配置、随机凭据及旧配置保留。
- `desktop/server-process.cjs`、`server.cjs`、`local-db.cjs`：服务进程、本地库检查和补表。
- `src/sync/`：本地与 PostgreSQL 的同步、镜像和冲突副本。
- `scripts/build-portable.mjs`：模板、构建、组装的统一入口。

数据库变更应同时适配 SQLite 和 PostgreSQL；需要同步的新表还应登记到 `src/sync/tables.ts`。Web 构建可能执行云端迁移，桌面打包不会执行 Web 构建的云端前置脚本。
