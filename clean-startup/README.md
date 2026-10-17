# Clean Startup

每次启动 Obsidian 时，把界面恢复成干净状态，而不是还原上次关闭时的样子。

## 解决的问题

Obsidian 默认会记住退出时的布局：开了七八个标签页直接关掉，下次打开还是那七八个；文件夹树也停留在上次展开的位置。

本插件在启动时自动执行：

1. **关闭主编辑区的所有标签页**，只留一个空白页
2. **折叠文件列表里的所有文件夹**，只显示顶层
3. **折叠右侧栏**（反向链接、大纲等面板）

左侧栏保持常驻，只是里面的文件夹树是收起的。如果想连左侧栏一起收起，在设置里打开「折叠左侧栏」。

## 安装

### 方式一：BRAT（可自动更新）

1. 安装并启用 BRAT 插件
2. 命令面板运行 `BRAT: Add a beta plugin for testing`
3. 输入仓库地址：

   ```
   Godwin9527/obsidian-plugins
   ```

   > 只能填仓库根路径。BRAT 的地址校验正则只接受 `user/repo` 或 `https://github.com/user/repo`，**不支持 `tree/main/子目录` 形式的链接**。
4. BRAT 会从 [Releases](https://github.com/Godwin9527/obsidian-plugins/releases) 下载 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/clean-startup/`

> BRAT 只读 Release 附件，不读仓库源码。若报「没有找到发布的版本」，说明该仓库没有 Release，需要先发版。

### 方式二：手动安装

1. 下载本文件夹（`clean-startup`）
2. 复制到你的库目录下：

   ```
   <你的库路径>/.obsidian/plugins/clean-startup/
   ```

   最终结构应为：

   ```
   .obsidian/plugins/clean-startup/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. 重启 Obsidian
4. 设置 → 第三方插件 → 关闭「安全模式」（若已开启）→ 刷新列表 → 启用 **Clean Startup**

> 只需要 `main.js`、`manifest.json`、`styles.css` 三个文件。`src/`、`package.json` 等是开发用的，可以不复制。

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| 关闭所有标签页 | 开 | 关闭主编辑区全部标签，保留一个空白页 |
| 折叠所有文件夹 | 开 | 文件列表里的文件夹全部折叠 |
| 折叠右侧栏 | 开 | 收起右侧面板 |
| 折叠左侧栏 | 关 | 连整个左侧边栏一起收起 |
| 启动延迟 | 0 ms | 库较大、启动慢时可调到 200–500 ms |
| 输出诊断日志 | 开 | 写入库根目录 `clean-startup-debug.md`，排查用 |

设置里还有「立即清理」按钮，命令面板也有 `Clean Startup: 立即清理`，可随时手动触发。

## 排查问题

如果启动后标签没有全部关闭，打开库根目录的 `clean-startup-debug.md`，里面记录了每轮关闭的标签、失败原因，以及清理 1.5 秒后的复查结果：

- **立即复查还有残留** → 标签没关掉（通常是 deferred view 未加载）
- **立即复查为 0、1.5 秒后又出现** → 标签被 Obsidian 重新恢复（启动时序问题）

定位清楚后可在设置里关闭诊断日志。

## 工作原理

- 启动时 Obsidian 会读取 `.obsidian/workspace.json` 还原布局，插件在布局就绪（`onLayoutReady`）后立即改写当前布局
- Obsidian 1.7.2+ 起，后台标签使用 **deferred view**（延迟加载），`leaf.view` 只是占位符，直接 `detach()` 会失效。因此关闭前先 `await leaf.loadIfDeferred()`，并对残留标签用 `setViewState({type:"empty"})` 兜底置空
- 关闭顺序为「先非活动标签、后活动标签」，避免 Obsidian 在关闭过程中反复切换并加载新视图
- 最多执行 3 轮，每轮结束后复查，应对异步恢复；只剩空白页（`empty`）时立即停手，避免和 Obsidian 反复互相创建
- 文件夹折叠通过调用 `file-explorer` 视图内部的 `setCollapsed(true)` 实现
- 不做界面遮罩：清理在布局就绪后立即执行，不额外隐藏窗口，避免启动时整片灰屏

## 已知限制

- 文件夹折叠依赖 `file-explorer` 视图的内部结构（非公开 API），Obsidian 大版本更新后若失效，需相应调整 `collapseAllFolders()`
- 移动端侧边栏行为与桌面端不同，插件在移动端可运行但未做专门适配
- 插件只处理启动这一次，不影响你平时手动开关标签
- 首次安装前遗留的布局无法追溯，装好后第一次启动可能仍残留，从第二次起生效

## 开发

```bash
npm install
npm run dev     # 监听 src/main.ts，改动自动重新打包
npm run build   # 类型检查 + 生产构建
```

源码在 `src/main.ts`，`main.js` 是 esbuild 产物，不要直接改。

### 发布新版本（BRAT 用户靠这个更新）

1. `npm run build` 重新打包
2. 修改 `manifest.json` 的 `version`
3. 在仓库根目录运行 `./release.sh`

脚本会读取版本号、提交、打 tag、创建 Release 并上传三个文件。BRAT 只认 Release 附件，**光推 commit 不会让用户收到更新**。

## License

MIT
