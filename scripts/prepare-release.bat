@echo off
REM Lattice Release Preparation Script for Windows
REM 准备发布新版本的脚本（Windows 版本）

setlocal enabledelayedexpansion

echo.
echo 🚀 Lattice Release Preparation
echo ================================
echo.

REM 检查是否在项目根目录
if not exist "package.json" (
    echo ❌ Error: Must run from project root directory
    exit /b 1
)

REM 获取当前版本
for /f "tokens=*" %%i in ('node -p "require('./package.json').version"') do set CURRENT_VERSION=%%i
echo 📦 Current version: %CURRENT_VERSION%
echo.

REM 询问新版本号
set /p NEW_VERSION="Enter new version (or press Enter to keep %CURRENT_VERSION%): "
if "%NEW_VERSION%"=="" set NEW_VERSION=%CURRENT_VERSION%

echo.
echo 🔧 Preparing release v%NEW_VERSION%...
echo.

REM 1. 更新版本号
echo 1️⃣ Updating version numbers...
call npm version %NEW_VERSION% --no-git-tag-version

REM 手动提示更新 Tauri 配置
echo    ⚠️  Please manually update version in src-tauri/tauri.conf.json to %NEW_VERSION%
pause

REM 2. 安装依赖
echo.
echo 2️⃣ Installing dependencies...
call npm install

REM 3. 运行测试
echo.
echo 3️⃣ Running tests...
call npm run test:run
if errorlevel 1 (
    echo ❌ Tests failed! Please fix before releasing.
    exit /b 1
)

REM 4. 构建桌面应用
echo.
echo 4️⃣ Building desktop application...
call npm run tauri:build
if errorlevel 1 (
    echo ❌ Build failed! Please check errors above.
    exit /b 1
)

REM 5. 显示构建产物
echo.
echo 5️⃣ Build artifacts:
echo.
if exist "src-tauri\target\release\bundle" (
    dir /s /b src-tauri\target\release\bundle\*.exe src-tauri\target\release\bundle\*.msi 2>nul
) else (
    echo    ⚠️  No build artifacts found
)

REM 6. 提示创建 Git 标签
echo.
echo 6️⃣ To create git tag, run:
echo    git add package.json package-lock.json src-tauri/tauri.conf.json
echo    git commit -m "chore: bump version to %NEW_VERSION%"
echo    git tag -a "v%NEW_VERSION%" -m "Release v%NEW_VERSION%"
echo    git push origin main --tags

echo.
echo ✅ Release preparation complete!
echo.
echo 📋 Next steps:
echo    1. Push changes: git push origin main --tags
echo    2. Create GitHub Release: https://github.com/YOUR_USERNAME/lattice/releases/new
echo    3. Upload build artifacts from src-tauri\target\release\bundle\
echo    4. Use .github\RELEASE_TEMPLATE.md as release notes template
echo.
echo 🎉 Happy releasing!
echo.

pause
