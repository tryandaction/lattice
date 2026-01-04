@echo off
REM ============================================
REM Lattice 本地构建和发布脚本 (Windows)
REM 用于在 GitHub Actions 不可用时本地构建
REM ============================================

setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo.
echo ╔════════════════════════════════════════════╗
echo ║     Lattice 本地构建和发布工具             ║
echo ║     Local Build and Release Tool           ║
echo ╚════════════════════════════════════════════╝
echo.

REM 检查是否在项目根目录
if not exist "package.json" (
    echo [ERROR] 必须在项目根目录运行此脚本
    exit /b 1
)

REM 检查 Rust 是否安装
where rustc >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Rust 未安装或未添加到 PATH
    echo.
    echo 请先安装 Rust:
    echo   1. 访问 https://rustup.rs/
    echo   2. 下载并运行 rustup-init.exe
    echo   3. 重启终端或运行:
    echo      set PATH=%%USERPROFILE%%\.cargo\bin;%%PATH%%
    echo.
    pause
    exit /b 1
)

REM 获取当前版本
for /f "tokens=*" %%i in ('node -p "require('./package.json').version"') do set CURRENT_VERSION=%%i
echo [INFO] 当前版本: v%CURRENT_VERSION%
echo.

REM 选择操作
echo 请选择操作:
echo   1. 构建当前版本
echo   2. 更新版本并构建
echo   3. 仅构建 (跳过测试)
echo   4. 清理并重新构建
echo   5. 退出
echo.
set /p CHOICE="请输入选项 (1-5): "

if "%CHOICE%"=="5" exit /b 0
if "%CHOICE%"=="1" goto BUILD
if "%CHOICE%"=="2" goto UPDATE_VERSION
if "%CHOICE%"=="3" goto BUILD_ONLY
if "%CHOICE%"=="4" goto CLEAN_BUILD

echo [ERROR] 无效选项
exit /b 1

:UPDATE_VERSION
echo.
set /p NEW_VERSION="请输入新版本号 (当前: %CURRENT_VERSION%): "
if "%NEW_VERSION%"=="" (
    echo [INFO] 保持当前版本
    goto BUILD
)

echo [INFO] 更新版本到 v%NEW_VERSION%...
call npm version %NEW_VERSION% --no-git-tag-version

REM 更新 Tauri 配置中的版本
powershell -Command "(Get-Content 'src-tauri\tauri.conf.json') -replace '\"version\": \"[^\"]+\"', '\"version\": \"%NEW_VERSION%\"' | Set-Content 'src-tauri\tauri.conf.json'"
echo [OK] 版本已更新

:BUILD
echo.
echo ════════════════════════════════════════════
echo  步骤 1/4: 安装依赖
echo ════════════════════════════════════════════
call npm install
if errorlevel 1 (
    echo [ERROR] npm install 失败
    exit /b 1
)
echo [OK] 依赖安装完成

echo.
echo ════════════════════════════════════════════
echo  步骤 2/4: 构建 Next.js
echo ════════════════════════════════════════════
call npm run build
if errorlevel 1 (
    echo [ERROR] Next.js 构建失败
    exit /b 1
)
echo [OK] Next.js 构建完成

goto BUILD_TAURI

:BUILD_ONLY
echo.
echo [INFO] 跳过依赖安装，直接构建...

:BUILD_TAURI
echo.
echo ════════════════════════════════════════════
echo  步骤 3/4: 构建 Tauri 桌面应用
echo ════════════════════════════════════════════
echo [INFO] 这可能需要 2-5 分钟...
call npm run tauri build
if errorlevel 1 (
    echo [ERROR] Tauri 构建失败
    exit /b 1
)
echo [OK] Tauri 构建完成

goto SHOW_RESULTS

:CLEAN_BUILD
echo.
echo [INFO] 清理构建缓存...
if exist "src-tauri\target" (
    echo [INFO] 删除 Rust 构建缓存...
    rmdir /s /q "src-tauri\target"
)
if exist ".next" (
    echo [INFO] 删除 Next.js 缓存...
    rmdir /s /q ".next"
)
if exist "out" (
    echo [INFO] 删除输出目录...
    rmdir /s /q "out"
)
echo [OK] 清理完成
goto BUILD

:SHOW_RESULTS
echo.
echo ════════════════════════════════════════════
echo  步骤 4/4: 构建结果
echo ════════════════════════════════════════════
echo.

REM 获取最终版本
for /f "tokens=*" %%i in ('node -p "require('./package.json').version"') do set FINAL_VERSION=%%i

echo 构建版本: v%FINAL_VERSION%
echo.
echo 生成的安装包:
echo ─────────────────────────────────────────────

set MSI_FILE=src-tauri\target\release\bundle\msi\Lattice_%FINAL_VERSION%_x64_en-US.msi
set NSIS_FILE=src-tauri\target\release\bundle\nsis\Lattice_%FINAL_VERSION%_x64-setup.exe
set EXE_FILE=src-tauri\target\release\lattice.exe

if exist "%MSI_FILE%" (
    for %%A in ("%MSI_FILE%") do echo   [MSI]  %%~nxA (%%~zA bytes^)
) else (
    echo   [MSI]  未找到
)

if exist "%NSIS_FILE%" (
    for %%A in ("%NSIS_FILE%") do echo   [NSIS] %%~nxA (%%~zA bytes^)
) else (
    echo   [NSIS] 未找到
)

if exist "%EXE_FILE%" (
    for %%A in ("%EXE_FILE%") do echo   [EXE]  %%~nxA (%%~zA bytes^)
) else (
    echo   [EXE]  未找到
)

echo.
echo ─────────────────────────────────────────────
echo.

REM 创建发布目录
set RELEASE_DIR=releases\v%FINAL_VERSION%
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"

echo 是否复制安装包到发布目录? (%RELEASE_DIR%)
set /p COPY_FILES="(Y/N): "
if /i "%COPY_FILES%"=="Y" (
    if exist "%MSI_FILE%" copy "%MSI_FILE%" "%RELEASE_DIR%\" >nul
    if exist "%NSIS_FILE%" copy "%NSIS_FILE%" "%RELEASE_DIR%\" >nul
    if exist "%EXE_FILE%" copy "%EXE_FILE%" "%RELEASE_DIR%\" >nul
    echo [OK] 文件已复制到 %RELEASE_DIR%
)

echo.
echo ╔════════════════════════════════════════════╗
echo ║  构建完成!                                 ║
echo ╚════════════════════════════════════════════╝
echo.
echo 下一步操作:
echo.
echo 1. 手动上传到 GitHub Release:
echo    https://github.com/tryandaction/lattice/releases/new
echo.
echo 2. 创建 Git 标签:
echo    git add -A
echo    git commit -m "chore: release v%FINAL_VERSION%"
echo    git tag -a "v%FINAL_VERSION%" -m "Release v%FINAL_VERSION%"
echo    git push origin main --tags
echo.
echo 3. 上传以下文件到 Release:
if exist "%MSI_FILE%" echo    - %MSI_FILE%
if exist "%NSIS_FILE%" echo    - %NSIS_FILE%
if exist "%EXE_FILE%" echo    - %EXE_FILE%
echo.
echo 4. 使用 .github\RELEASE_TEMPLATE.md 作为发布说明模板
echo.

pause
