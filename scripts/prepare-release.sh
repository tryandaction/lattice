#!/bin/bash

# Lattice Release Preparation Script
# 准备发布新版本的脚本

set -e

echo "🚀 Lattice Release Preparation"
echo "================================"

# 检查是否在项目根目录
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run from project root directory"
    exit 1
fi

# 获取当前版本
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# 询问新版本号
read -p "Enter new version (or press Enter to keep $CURRENT_VERSION): " NEW_VERSION
if [ -z "$NEW_VERSION" ]; then
    NEW_VERSION=$CURRENT_VERSION
fi

echo ""
echo "🔧 Preparing release v$NEW_VERSION..."
echo ""

# 1. 更新版本号
echo "1️⃣ Updating version numbers..."
npm version $NEW_VERSION --no-git-tag-version

# 更新 Tauri 配置中的版本号
if command -v jq &> /dev/null; then
    jq ".version = \"$NEW_VERSION\"" src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
    mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
    echo "   ✅ Updated tauri.conf.json"
else
    echo "   ⚠️  jq not found, please manually update src-tauri/tauri.conf.json"
fi

# 2. 安装依赖
echo ""
echo "2️⃣ Installing dependencies..."
npm install

# 3. 运行测试
echo ""
echo "3️⃣ Running tests..."
npm run test:run || {
    echo "❌ Tests failed! Please fix before releasing."
    exit 1
}

# 4. 构建桌面应用
echo ""
echo "4️⃣ Building desktop application..."
npm run tauri:build || {
    echo "❌ Build failed! Please check errors above."
    exit 1
}

# 5. 显示构建产物
echo ""
echo "5️⃣ Build artifacts:"
echo ""
if [ -d "src-tauri/target/release/bundle" ]; then
    find src-tauri/target/release/bundle -type f \( -name "*.exe" -o -name "*.msi" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" \) -exec ls -lh {} \;
else
    echo "   ⚠️  No build artifacts found"
fi

# 6. 创建 Git 标签
echo ""
read -p "6️⃣ Create git tag v$NEW_VERSION? (y/n): " CREATE_TAG
if [ "$CREATE_TAG" = "y" ]; then
    git add package.json package-lock.json src-tauri/tauri.conf.json
    git commit -m "chore: bump version to $NEW_VERSION"
    git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
    echo "   ✅ Created tag v$NEW_VERSION"
    echo ""
    echo "   To push: git push origin main --tags"
fi

echo ""
echo "✅ Release preparation complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Push changes: git push origin main --tags"
echo "   2. Create GitHub Release: https://github.com/YOUR_USERNAME/lattice/releases/new"
echo "   3. Upload build artifacts from src-tauri/target/release/bundle/"
echo "   4. Use .github/RELEASE_TEMPLATE.md as release notes template"
echo ""
echo "🎉 Happy releasing!"
