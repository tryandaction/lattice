@echo off
setlocal
node "%~dp0prepare-release.mjs" --skip-qa %*
