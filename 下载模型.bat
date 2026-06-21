@echo off
chcp 65001 >nul
echo ========================================
echo 下载本地 Embedding 模型
echo ========================================
echo.

set MODEL_DIR=%APPDATA%\poe2-bd-app\models
set MODEL_ID=Xenova/bge-small-zh-v1.5
set MIRROR=https://hf-mirror.com

echo 模型目录: %MODEL_DIR%
echo 模型: %MODEL_ID%
echo 镜像: %MIRROR%
echo.

if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"

echo 正在下载模型文件...
echo 这可能需要几分钟,取决于网络速度
echo.

REM 使用 PowerShell 下载
powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; $modelDir = '%MODEL_DIR%'; $modelId = '%MODEL_ID%'; $mirror = '%MIRROR%'; $files = @('config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', 'onnx/model.onnx', 'onnx/model_quantized.onnx'); foreach ($f in $files) { $url = \"$mirror/$modelId/resolve/main/$f\"; $outPath = Join-Path $modelDir ($modelId -replace '/', '--') + '/' + $f; $outDir = Split-Path $outPath -Parent; if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }; Write-Host \"下载: $f\"; try { Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing; Write-Host \"  完成\" } catch { Write-Host \"  失败: $($_.Exception.Message)\" } } }"

echo.
echo ========================================
echo 下载完成!
echo 请重启应用后再次尝试向量化
echo ========================================
pause
