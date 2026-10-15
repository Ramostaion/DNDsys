# Loaded by start-dnd.ps1; installs only into the project's .launcher folder.
function Test-DndNode([string]$Candidate) {
    if (!$Candidate -or !(Test-Path -LiteralPath $Candidate)) { return $false }
    try { $version = & $Candidate --version 2>$null; return ($LASTEXITCODE -eq 0 -and "$version" -match '^v24\.') } catch { return $false }
}

function Test-DndPnpm([string]$Candidate, [string]$Version) {
    if (!$Candidate -or !(Test-Path -LiteralPath $Candidate)) { return $false }
    try { $installed = & $Candidate --version 2>$null; return ($LASTEXITCODE -eq 0 -and "$installed".Trim() -eq $Version) } catch { return $false }
}

function Get-DndPortableNode([string]$Root, [switch]$CheckOnly) {
    if (![Environment]::Is64BitOperatingSystem) { throw '需要 64 位 Windows 系统。' }
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    $version = '24.18.0'
    $name = "node-v$version-win-$architecture"
    $runtime = Join-Path $Root '.launcher\runtime'
    $nodeFile = Join-Path $runtime "$name\node.exe"
    $npmFile = Join-Path $runtime "$name\npm.cmd"
    $npmEntry = Join-Path $runtime "$name\node_modules\npm\bin\npm-cli.js"
    if ((Test-DndNode $nodeFile) -and (Test-Path -LiteralPath $npmFile) -and (Test-Path -LiteralPath $npmEntry)) { return $nodeFile }
    if ($CheckOnly) { throw '未找到 Node.js 24；正常启动 BAT 会自动下载。' }
    $downloads = Join-Path $Root '.launcher\downloads'
    [void][IO.Directory]::CreateDirectory($downloads)
    [void][IO.Directory]::CreateDirectory($runtime)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $archive = Join-Path $downloads "$name.zip"
    Write-Host '正在从 Node.js 官网下载项目专用运行环境…' -ForegroundColor Cyan
    try {
        $checksums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 45).Content
        $checksumLine = @($checksums -split "`n" | Where-Object { $_ -match ("\s" + [regex]::Escape("$name.zip") + '$') })
        if ($checksumLine.Count -ne 1) { throw '没有找到对应的官方校验值。' }
        $expectedHash = ($checksumLine[0] -split '\s+')[0]
        if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $expectedHash) {
            $partial = "$archive.part"
            Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/$name.zip" -UseBasicParsing -OutFile $partial -TimeoutSec 300
            if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $expectedHash) { throw '下载文件不完整，请重新启动以重试。' }
            Move-Item -LiteralPath $partial -Destination $archive -Force
        }
        Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    } catch { throw "Node.js 下载或解压失败，请检查服务器网络后重试：$($_.Exception.Message)" }
    if (!(Test-DndNode $nodeFile)) { throw '下载的 Node.js 无法运行，请检查 Windows 版本和系统架构。' }
    return $nodeFile
}

function Initialize-DndRuntime([string]$Root, [switch]$CheckOnly, [switch]$ForcePortable) {
    $nodePath = $null
    if (!$ForcePortable) {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($command -and (Test-DndNode $command.Source)) { $nodePath = $command.Source }
    }
    if (!$nodePath) {
        $nodePath = Get-DndPortableNode $Root -CheckOnly:$CheckOnly
    }
    $env:PATH = (Split-Path $nodePath -Parent) + ';' + $env:PATH
    $package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    if ($package.packageManager -notmatch '^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$') { throw '项目未指定有效的 pnpm 版本。' }
    $pnpmVersion = $Matches[1]
    $localPnpm = Join-Path $Root '.launcher\runtime\pnpm\node_modules\.bin\pnpm.cmd'
    $pnpmPath = $null
    if (!$ForcePortable) {
        $commands = @(Get-Command pnpm.cmd,pnpm.exe -ErrorAction SilentlyContinue)
        foreach ($command in $commands) { if (Test-DndPnpm $command.Source $pnpmVersion) { $pnpmPath=$command.Source; break } }
    }
    if (!$pnpmPath -and (Test-DndPnpm $localPnpm $pnpmVersion)) { $pnpmPath=$localPnpm }
    if (!$pnpmPath) {
        if ($CheckOnly) { throw "未找到 pnpm $pnpmVersion；正常启动 BAT 会自动安装。" }
        $npmPath = Join-Path (Split-Path $nodePath -Parent) 'npm.cmd'
        if (!(Test-Path -LiteralPath $npmPath)) {
            $nodePath=Get-DndPortableNode $Root
            $env:PATH=(Split-Path $nodePath -Parent)+';'+$env:PATH
            $npmPath=Join-Path (Split-Path $nodePath -Parent) 'npm.cmd'
        }
        $prefix=Join-Path $Root '.launcher\runtime\pnpm'
        $cache=Join-Path $Root '.launcher\npm-cache'
        Write-Host "正在安装项目专用 pnpm $pnpmVersion…" -ForegroundColor Cyan
        Invoke-ManagedCommand $npmPath ('install --prefix "{0}" --cache "{1}" --registry https://registry.npmjs.org --no-audit --no-fund pnpm@{2}' -f $prefix,$cache,$pnpmVersion)
        if (!(Test-DndPnpm $localPnpm $pnpmVersion)) { throw 'pnpm 安装后不可用，请查看上方下载提示。' }
        $pnpmPath=$localPnpm
    }
    return [pscustomobject]@{NodePath=$nodePath;PnpmPath=$pnpmPath;PnpmVersion=$pnpmVersion}
}
