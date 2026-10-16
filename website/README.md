# Infinia 项目介绍页已合并

介绍页源码已迁移至 `store-web/src/intro`，不再是独立 Next.js workspace。

- 开发：仓库根目录运行 `yarn web`，访问 http://localhost:8089/。
- 商店：http://localhost:8089/store。
- 构建：`yarn web:build`，两者共用 `store-web/dist`。
- `yarn website` / `yarn website:build` 保留为兼容别名，不再启动第二个服务。
- 原有 `website/out`、`.next`、`node_modules` 如仍存在，仅为历史构建缓存，不参与构建与部署。

# 官网站内文档（/docs）

官网自带文档界面（`store-web/src/intro/docs/`），不再跳转 GitHub Pages：

- 路由 `/docs/{en|zh}/<slug>`，内容在构建时打包进 SPA，按页懒加载。
- 文档源是 FengYu 仓库的 `docs/{en,zh}`（VitePress 源文件）。同步：
  `yarn docs:sync`（默认取兄弟目录 `../FengYu/docs`，可用 `--src <path>` 或 `FENGYU_DOCS` 覆盖）。
  同步会重建 `store-web/src/intro/docs/content/` 并生成 `manifest.json`（页面标题 + 源分支，
  用于"在 GitHub 上编辑"链接），产物随仓库提交，CI 无需访问 FengYu 仓库。
- 侧栏分组定义在 `store-web/src/intro/docs/tree.ts`，需与 FengYu 仓库
  `docs/.vitepress/config.ts` 的侧栏保持一致（`docs:sync` 不会自动调整分组）。
