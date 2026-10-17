# Obsidian Plugins

个人 Obsidian 插件合集仓库，用于存放与版本管理自用/自研的 Obsidian 插件。

## 插件列表

| 插件 | 说明 |
|---|---|
| [clean-startup](./clean-startup) | 每次启动时关闭所有标签、折叠文件夹树与右侧栏，保持干净的开局界面 |

## 目录结构

```
obsidian-plugins/
└── <插件名>/
    ├── manifest.json      # 插件元信息（id / name / version / minAppVersion）
    ├── main.js            # 插件主逻辑（构建产物）
    ├── styles.css         # 可选，样式文件
    └── README.md          # 插件说明
```

## 使用方法

1. 下载或克隆本仓库
2. 将目标插件文件夹复制到 Obsidian 库的插件目录：
   - Windows：`<你的库路径>/.obsidian/plugins/<插件名>/`
   - macOS / Linux：`<你的库路径>/.obsidian/plugins/<插件名>/`
3. 打开 Obsidian → 设置 → 第三方插件 → 关闭「安全模式」→ 启用对应插件

## 说明

- 仓库内插件均为个人使用，未发布到 Obsidian 官方社区插件市场
- 使用前请自行备份库数据

## License

MIT
