# Download local Embedding model script
$ProgressPreference = 'SilentlyContinue'

$modelDir = "$env:APPDATA\poe2-bd-app\models"
$modelId = "Xenova/bge-small-zh-v1.5"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Download Local Embedding Model" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Create directory
$modelPath = Join-Path $modelDir ($modelId -replace '/', '--')
if (!(Test-Path $modelPath)) {
    New-Item -ItemType Directory -Path $modelPath -Force | Out-Null
}

# Create onnx subdirectory
$onnxDir = Join-Path $modelPath "onnx"
if (!(Test-Path $onnxDir)) {
    New-Item -ItemType Directory -Path $onnxDir -Force | Out-Null
}

# Multiple mirror sources
$mirrors = @(
    "https://hf-mirror.com",
    "https://huggingface.co"
)

# Files to download
$files = @(
    @{name="config.json"; path="config.json"},
    @{name="tokenizer.json"; path="tokenizer.json"},
    @{name="tokenizer_config.json"; path="tokenizer_config.json"},
    @{name="vocab.txt"; path="vocab.txt"},
    @{name="model.onnx"; path="onnx/model.onnx"}
)

Write-Host "Downloading model files..." -ForegroundColor Yellow
Write-Host ""

foreach ($f in $files) {
    $outPath = Join-Path $modelPath $f.path
    $outDir = Split-Path $outPath -Parent

    if (!(Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }

    # Skip already downloaded files
    if (Test-Path $outPath) {
        Write-Host "$($f.name) - already exists, skip" -ForegroundColor Gray
        continue
    }

    $downloaded = $false
    foreach ($mirror in $mirrors) {
        $url = "$mirror/$modelId/resolve/main/$($f.path)"
        Write-Host "Download: $($f.name)" -NoNewline
        try {
            Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing -TimeoutSec 300
            Write-Host " - OK" -ForegroundColor Green
            $downloaded = $true
            break
        } catch {
            Write-Host " - failed, try next..." -ForegroundColor Yellow
        }
    }
    
    if (!$downloaded) {
        Write-Host "$($f.name) - all sources failed" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
$fileCount = (Get-ChildItem -Path $modelPath -Recurse -File).Count
if ($fileCount -ge 5) {
    Write-Host "Download complete! $fileCount files" -ForegroundColor Green
    Write-Host "Please restart the app and try vectorization again" -ForegroundColor Yellow
} else {
    Write-Host "Some files failed, check network and retry" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
