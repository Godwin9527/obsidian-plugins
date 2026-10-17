#!/usr/bin/env bash
# 发布新版本到 GitHub Release（BRAT 依赖 Release 附件，不会读仓库源码）
# 用法：改完代码后先 npm run build，再改 manifest.json 的 version，最后运行本脚本
set -euo pipefail

cd "$(dirname "$0")"

PLUGIN_DIR="clean-startup"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$PLUGIN_DIR/manifest.json" | head -1)

if [ -z "$VERSION" ]; then
	echo "无法从 $PLUGIN_DIR/manifest.json 读取 version" >&2
	exit 1
fi

echo "准备发布版本: $VERSION"

# 确认构建产物存在
for f in main.js manifest.json styles.css; do
	if [ ! -f "$PLUGIN_DIR/$f" ]; then
		echo "缺少文件: $PLUGIN_DIR/$f（请先运行 npm run build）" >&2
		exit 1
	fi
done

# 提交当前改动
git add -A
if ! git diff --cached --quiet; then
	git commit -m "release: $VERSION"
fi

# 打 tag 并推送
if git rev-parse "$VERSION" >/dev/null 2>&1; then
	echo "tag $VERSION 已存在，跳过创建"
else
	git tag -a "$VERSION" -m "$VERSION"
fi
git push origin HEAD --tags

# 创建 release 并上传三个文件（文件名必须是 main.js / manifest.json / styles.css）
gh release create "$VERSION" \
	--title "$VERSION" \
	--latest \
	--generate-notes \
	"$PLUGIN_DIR/main.js" \
	"$PLUGIN_DIR/manifest.json" \
	"$PLUGIN_DIR/styles.css"

echo "完成: https://github.com/Godwin9527/obsidian-plugins/releases/tag/$VERSION"
