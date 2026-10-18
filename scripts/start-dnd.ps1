param([switch]$NoBrowser, [switch]$CheckOnly, [switch]$Development)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$env:PRISMA_HIDE_UPDATE_MESSAGE = '1'
$env:NODE_ENV = 'development' # Installation/build need compiler dependencies even on a production host.
$host.UI.RawUI.WindowTitle = '万象跑团 - 关闭这个窗口即可停止'
$job = $null
$lockFile = $null
$exitCode = 0
$diagnosticPath = Join-Path $projectRoot '.launcher\last-startup.json'
$diagnostic = [ordered]@{ startedAt = [DateTime]::Now.ToString('o'); processId = $PID; projectRoot = $projectRoot; status = 'checking'; stage = 'configuration' }

function Save-StartupDiagnostic {
    try {
        [void][System.IO.Directory]::CreateDirectory((Split-Path -Parent $diagnosticPath))
        $json = $diagnostic | ConvertTo-Json -Depth 8
        [System.IO.File]::WriteAllText($diagnosticPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    } catch { Write-Host '启动诊断日志未能保存。' -ForegroundColor DarkGray }
}

function Test-Port([string]$Address, [int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connect = $client.ConnectAsync($Address, $Port)
        if (-not $connect.Wait(1000)) { return $false }
        return $client.Connected
    } catch { return $false } finally { $client.Dispose() }
}

function Test-LocalDatabaseReady([int]$Port, [string]$Name) {
    try {
        $reply = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/health" -f $Port) -TimeoutSec 2
        return $reply.name -eq $Name
    } catch { return $false }
}

function Start-Managed([string]$Arguments, [switch]$Quiet) {
    $command = '"{0}" /d /s /c ""{1}" {2}{3}"' -f $env:ComSpec, $pnpmPath, $Arguments, $(if ($Quiet) {' >nul 2>&1'} else {''})
    return $job.Start($env:ComSpec, $command, $projectRoot)
}

function Invoke-ManagedCommand([string]$Executable, [string]$Arguments) {
    $command = '"{0}" /d /s /c ""{1}" {2}"' -f $env:ComSpec,$Executable,$Arguments
    $process = $job.Start($env:ComSpec,$command,$projectRoot)
    try {
        while (!$process.WaitForExit(250)) { }
        if ($process.ExitCode -ne 0) { throw '环境安装失败，请查看上方提示并检查网络，然后重新双击 BAT。' }
    } finally { $process.Dispose() }
}

function Start-LocalDatabase {
    $entry = Join-Path $PSScriptRoot 'launcher-local-database.mjs'
    $command = '"{0}" /d /s /c ""{1}" "{2}" >>"{3}" 2>&1"' -f $env:ComSpec,$nodePath,$entry,$databaseLog
    return $job.Start($env:ComSpec, $command, $projectRoot)
}

function Stop-DatabaseStartup([string]$Message) {
    if (Test-Path -LiteralPath $databaseLog) {
        Write-Host '数据库启动日志：' -ForegroundColor Yellow
        Get-Content -LiteralPath $databaseLog -Encoding UTF8 -Tail 12 | ForEach-Object {
            Write-Host ([regex]::Replace($_, '(?i)(?:postgres(?:ql)?|prisma\+postgres)://\S+', '[连接地址已省略]'))
        }
    }
    throw "$Message 详细日志：$databaseLog。原数据库未重置。"
}

function Invoke-Step([string]$Title, [string]$Arguments) {
    Write-Host "`n$Title" -ForegroundColor Cyan
    $process = Start-Managed $Arguments
    try {
        while (-not $process.WaitForExit(250)) { }
        if ($process.ExitCode -ne 0) { throw "$Title 失败，请查看上方提示。" }
    } finally { $process.Dispose() }
}

function Wait-Service([string]$Url, [System.Diagnostics.Process]$Process, [string]$Name, [int]$TimeoutSeconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw "$Name 已退出，请查看上方提示。" }
        try {
            $reply = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($reply.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 400
    }
    throw "$Name 启动超时，请查看上方提示。"
}

try {
    Write-Host '万象跑团 · 一键启动' -ForegroundColor Yellow
    Write-Host '本窗口保持打开。玩完先保存，再点右上角 X 关闭程序。'
    if (!(Test-Path -LiteralPath 'apps\api\.env')) { throw '缺少 apps/api/.env；迁移测试数据时请连同原配置文件一起复制。' }
    $runtimeDir = Join-Path $projectRoot '.launcher'
    [void][IO.Directory]::CreateDirectory($runtimeDir)
    if (!$CheckOnly) {
        try { $lockFile = [IO.File]::Open((Join-Path $runtimeDir 'running.lock'),'OpenOrCreate','ReadWrite','None') }
        catch { throw '已有一键启动窗口在运行，请使用原窗口；关闭原窗口后才能重新启动。' }
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'LauncherJob.cs')
    $job = New-Object ProjectDnd.LauncherJob
    . (Join-Path $PSScriptRoot 'launcher-runtime.ps1')
    $diagnostic['stage'] = 'environment'
    Save-StartupDiagnostic
    $runtime = Initialize-DndRuntime $projectRoot -CheckOnly:$CheckOnly
    $nodePath = $runtime.NodePath
    $pnpmPath = $runtime.PnpmPath
    $windowsAppData = [Environment]::GetFolderPath('LocalApplicationData')
    $diagnostic['nodePath'] = $nodePath
    $diagnostic['pnpmPath'] = $pnpmPath
    $diagnostic['pnpmVersion'] = $runtime.PnpmVersion
    $diagnostic['powerShellVersion'] = $PSVersionTable.PSVersion.ToString()
    $diagnostic['userProfile'] = $env:USERPROFILE
    $diagnostic['environmentAppData'] = $env:LOCALAPPDATA
    $diagnostic['windowsAppData'] = $windowsAppData
    $diagnostic['windowsRegistrationExists'] = if ($windowsAppData) { Test-Path -LiteralPath (Join-Path $windowsAppData 'prisma-dev-nodejs\Data') } else { $false }
    Save-StartupDiagnostic
    $diagnostic['stage'] = 'configuration'
    $configArguments = @((Join-Path $PSScriptRoot 'launcher-config.mjs'))
    if ($Development) { $configArguments += '--development' }
    if ($windowsAppData) { $configArguments += @('--local-app-data', $windowsAppData) }
    $configOutput = & $nodePath @configArguments
    if ($LASTEXITCODE -ne 0) { throw '启动配置检查失败。' }
    $config = $configOutput | ConvertFrom-Json
    $env:DND_WEB_PORT = "$($config.webPort)"
    $env:DND_WEB_ORIGIN = $config.webOrigin
    $diagnostic['configuration'] = $config
    Save-StartupDiagnostic
    # The CLI must use the same existing data root found by the configuration check.
    if ($config.localDatabaseAppData) { $env:LOCALAPPDATA = $config.localDatabaseAppData }
    Write-Host "项目目录：$projectRoot" -ForegroundColor DarkGray
    Write-Host "数据库地址：$($config.db.host):$($config.db.port)" -ForegroundColor DarkGray
    if ($config.databaseStateDir) {
        Write-Host "本地数据库登记目录：$($config.databaseStateDir)" -ForegroundColor DarkGray
    }
    if (!$CheckOnly) {
        foreach ($port in (@($config.apiPort,$config.webPort) | Select-Object -Unique)) {
            if (Test-Port '127.0.0.1' $port) { throw "端口 $port 已被占用。请先关闭原有的开发服务或启动窗口，再双击 BAT。现有进程没有被关闭。" }
        }
    }
    $dependencyOutput = & $nodePath (Join-Path $PSScriptRoot 'launcher-dependencies.mjs')
    if ($LASTEXITCODE -ne 0) { throw '无法检查项目依赖，请查看上方提示。' }
    $dependencyState = $dependencyOutput | ConvertFrom-Json
    if (!$dependencyState.ready) {
        if ($CheckOnly) { throw '项目依赖需要安装或修复；正常双击 BAT 会自动处理。' }
        $diagnostic['stage'] = 'dependencies'
        Save-StartupDiagnostic
        $previousCi = $env:CI
        try {
            $env:CI = 'true'
            Invoke-Step ('正在安装／修复项目依赖：' + $dependencyState.reason) 'install --frozen-lockfile --force'
        } finally { $env:CI = $previousCi }
        $verifiedDependencies = & $nodePath (Join-Path $PSScriptRoot 'launcher-dependencies.mjs') --record
        if ($LASTEXITCODE -ne 0) { throw '项目依赖安装后检查失败。' }
    }
    if ($CheckOnly) {
        $diagnostic['status'] = 'checked'
        Save-StartupDiagnostic
        Write-Host "配置有效。模式：$($config.mode)；网页：$($config.webOrigin)；数据库：$($config.db.host):$($config.db.port)"
        if ($config.localServer) { Write-Host "已识别本地数据库：$($config.localServer.name)" }
        elseif ($config.localDatabaseIssue) { Write-Host "本地数据库识别结果：$($config.localDatabaseIssue)" -ForegroundColor Yellow }
        exit 0
    }

    $databaseProcess = $null
    $diagnostic['stage'] = 'database'
    Save-StartupDiagnostic
    if (Test-Port $config.db.host $config.db.port) {
        Write-Host '数据库已运行，继续使用；关闭本窗口时会保留这项已有服务。' -ForegroundColor DarkGray
    } elseif ($config.localServer) {
        if ($config.localDatabaseAppData -eq (Join-Path $projectRoot '.local-database')) {
            $pathResult = & $nodePath (Join-Path $PSScriptRoot 'launcher-database.mjs') $config.localServer.name
            if ($LASTEXITCODE -ne 0) { throw '复制后的数据库路径修复失败，请查看上方提示。' }
            if (($pathResult | ConvertFrom-Json).changed -gt 0) { Write-Host '已修正旧电脑的数据库路径，原登记文件已备份，测试数据保留。' -ForegroundColor DarkGray }
        }
        Write-Host '正在启动已有本地数据库…' -ForegroundColor Cyan
        $server = $config.localServer
        $runtimeScript = Join-Path $PSScriptRoot 'launcher-database-runtime.mjs'
        $runtimeOutput = & $nodePath $runtimeScript
        if ($LASTEXITCODE -ne 0) { throw '数据库运行环境检查失败，原数据未修改。' }
        $databaseRuntime = $runtimeOutput | ConvertFrom-Json
        if ($databaseRuntime.needsInstall) {
            Write-Host '正在准备项目专用数据库运行环境（首次使用需要下载）…' -ForegroundColor Cyan
            $npmPath = Join-Path (Split-Path $nodePath -Parent) 'npm.cmd'
            if (!(Test-Path -LiteralPath $npmPath)) { throw '缺少 npm，无法准备数据库运行环境；请使用完整的 Node.js 24 安装。' }
            Invoke-ManagedCommand $npmPath ('install --prefix "{0}" --cache "{1}" --registry https://registry.npmjs.org --no-audit --no-fund --workspaces=false @prisma/dev@0.25.2 @electric-sql/pglite@0.4.3' -f $databaseRuntime.folder,(Join-Path $projectRoot '.launcher\npm-cache'))
            $runtimeOutput = & $nodePath $runtimeScript --check
            if ($LASTEXITCODE -ne 0) { throw '数据库运行环境安装后检查失败。' }
            $databaseRuntime = $runtimeOutput | ConvertFrom-Json
        }
        if (!$databaseRuntime.ready) { throw "数据库运行环境不完整：$($databaseRuntime.reason)。原数据未修改。" }
        $diagnostic['databaseRuntime'] = $databaseRuntime.folder
        $databaseLog = Join-Path $projectRoot '.launcher\database-startup.log'
        $diagnostic['databaseLog'] = $databaseLog
        Save-StartupDiagnostic
        [IO.File]::WriteAllText($databaseLog, '', (New-Object System.Text.UTF8Encoding($false)))
        $databaseProcess = Start-LocalDatabase
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        $databaseRetries = 0
        # The SQL port can open before Prisma finishes recovering its companion service.
        # Wait for full startup so a briefly opened port cannot hide a failed process.
        while (-not (Test-Port $config.db.host $config.db.port) -or -not (Test-LocalDatabaseReady $server.port $server.name)) {
            if ([DateTime]::UtcNow -gt $deadline) { Stop-DatabaseStartup '本地数据库启动超时。' }
            if ($databaseProcess.HasExited) {
                $lockRecovery = (Get-Content -LiteralPath $databaseLog -Encoding UTF8 -Tail 3) -match 'ELOCKED|already being held'
                # The companion service's lock can remain fresh for 30 seconds after a hard close.
                $maxRetries = if ($lockRecovery) { 12 } else { 2 }
                if ($databaseRetries -ge $maxRetries) { Stop-DatabaseStartup '本地数据库连续启动失败。' }
                $databaseRetries++
                Write-Host "数据库未就绪，正在恢复重试（$databaseRetries/$maxRetries）…" -ForegroundColor DarkGray
                $databaseProcess.Dispose()
                # A hard console close can leave a briefly stale Prisma file lock.
                # Release failed startup descendants and let the CLI recover it.
                $job.Dispose()
                $job = New-Object ProjectDnd.LauncherJob
                Start-Sleep -Seconds 3
                $databaseProcess = Start-LocalDatabase
            }
            Start-Sleep -Milliseconds 400
        }
    } else {
        if ($config.databaseStateDir) {
            throw "未识别到可自动启动的本地数据库。$($config.localDatabaseIssue) 详细诊断已保存到 $diagnosticPath。"
        }
        throw '配置的数据库没有运行。请先启动配置中的 PostgreSQL 数据库，再重新双击 BAT。'
    }

    $diagnostic['stage'] = 'prepare'
    Save-StartupDiagnostic
    if ($config.mode -eq 'development') { Invoke-Step '准备共享模块' '--filter @dnd/shared build' }
    Invoke-Step '准备数据库客户端' '--filter @dnd/api exec prisma generate'
    Invoke-Step '等待数据库准备完成…' '--filter @dnd/api exec node ../../scripts/launcher-db-ready.mjs'
    Invoke-Step '应用已有数据库更新（保留原数据）' '--filter @dnd/api exec prisma migrate deploy'
    Write-Host "`n正在启动后台与网页…" -ForegroundColor Cyan
    $webProcess = $null
    if ($config.mode -eq 'production') {
        $buildState = (& $nodePath (Join-Path $PSScriptRoot 'launcher-build.mjs')) | ConvertFrom-Json
        if (!$buildState.ready) {
            Invoke-Step '构建正式网页与后台（首次启动或源码更新）' 'build'
            $buildRecord = & $nodePath (Join-Path $PSScriptRoot 'launcher-build.mjs') --record
            if ($LASTEXITCODE -ne 0) { throw '正式构建检查失败。' }
        } else { Write-Host '源码未变化，直接复用正式构建。' -ForegroundColor DarkGray }
        $env:NODE_ENV = 'production'
        $env:PORT = "$($config.webPort)"
        $env:WEB_STATIC_DIR = Join-Path $projectRoot 'apps\web\dist'
        $env:UV_THREADPOOL_SIZE = "$($config.workerThreads)"
        if ($env:NODE_OPTIONS -notmatch '--max-old-space-size(?:=|\s)') {
            $env:NODE_OPTIONS = ("$($env:NODE_OPTIONS) --max-old-space-size=$($config.nodeHeapMb)").Trim()
        }
        Write-Host "正式运行：统一端口 $($config.webPort)，Node 堆上限 $($config.nodeHeapMb) MB，后台线程 $($config.workerThreads)。" -ForegroundColor DarkGray
        $apiProcess = Start-Managed '--filter @dnd/api start'
    } else {
        $env:NODE_ENV = 'development'
        $apiProcess = Start-Managed '--filter @dnd/api dev'
        $webProcess = Start-Managed ('--filter @dnd/web exec vite --host 0.0.0.0 --port {0} --strictPort' -f $config.webPort)
    }
    Wait-Service ("http://127.0.0.1:{0}/api/health" -f $config.apiPort) $apiProcess '后台' 180
    Wait-Service ("http://127.0.0.1:{0}/login" -f $config.webPort) $apiProcess '网页'
    Write-Host "`n启动完成：$($config.webOrigin)" -ForegroundColor Green
    $diagnostic['stage'] = 'running'
    $diagnostic['status'] = 'running'
    Save-StartupDiagnostic
    Write-Host '关闭本窗口会停止本次启动的后台、网页和本地数据库；已保存数据保留。'
    if (-not $NoBrowser) {
        try { Start-Process $config.webOrigin }
        catch { Write-Host "浏览器未能自动打开，请手动访问 $($config.webOrigin)" -ForegroundColor Yellow }
    }
    while ($true) {
        if ($apiProcess.HasExited -or ($webProcess -and $webProcess.HasExited) -or ($databaseProcess -and $databaseProcess.HasExited)) {
            throw '一项服务已停止，其余本次启动的服务也将关闭。请查看上方提示后重新启动。'
        }
        Start-Sleep -Seconds 1
    }
} catch {
    $diagnostic['status'] = 'failed'
    $diagnostic['error'] = $_.Exception.Message
    Save-StartupDiagnostic
    Write-Host "`n启动失败：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($job) { $job.Dispose() }
    if ($lockFile) { $lockFile.Dispose() }
}
exit $exitCode

