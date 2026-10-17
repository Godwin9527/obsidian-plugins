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

### 手动安装

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
| 清理前隐藏界面 | 开 | 避免启动瞬间闪出上次的标签页 |

设置里还有「立即清理」按钮，命令面板也有 `Clean Startup: 立即清理`，可随时手动触发。

## 工作原理

- 启动时 Obsidian 会读取 `.obsidian/workspace.json` 还原布局，插件在布局就绪（`onLayoutReady`）后立即改写当前布局
- 文件夹折叠通过调用 `file-explorer` 视图内部的 `setCollapsed(true)` 实现
- 为避免「先闪出旧标签再清空」，插件加载时给 `body` 加一个 class 把工作区隐藏，清理完成后移除，并有 3 秒兜底防止白屏

## 已知限制

- 文件夹折叠依赖 `file-explorer` 视图的内部结构（非公开 API），Obsidian 大版本更新后若失效，需相应调整 `collapseAllFolders()`
- 移动端侧边栏行为与桌面端不同，插件在移动端可运行但未做专门适配
- 插件只处理启动这一次，不影响你平时手动开关标签

## 开发

```bash
npm install
npm run dev     # 监听 src/main.ts，改动自动重新打包
npm run build   # 类型检查 + 生产构建
```

源码在 `src/main.ts`，`main.js` 是 esbuild 产物，不要直接改。

## License

MIT
