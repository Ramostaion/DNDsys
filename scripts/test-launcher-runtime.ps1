$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
Add-Type -Path (Join-Path $PSScriptRoot 'LauncherJob.cs')
$runtimeJob = New-Object ProjectDnd.LauncherJob
function Invoke-ManagedCommand([string]$Executable, [string]$Arguments) {
    $command = '"{0}" /d /s /c ""{1}" {2}"' -f $env:ComSpec,$Executable,$Arguments
    $process = $runtimeJob.Start($env:ComSpec,$command,$projectRoot)
    try { while (!$process.WaitForExit(250)) { }; if ($process.ExitCode -ne 0) { throw 'Runtime installer failed.' } }
    finally { $process.Dispose() }
}
try {
    . (Join-Path $PSScriptRoot 'launcher-runtime.ps1')
    # Exercise the missing-runtime branch even when the developer machine has Node.
    $first = Initialize-DndRuntime $projectRoot -ForcePortable
    if (!(Test-DndNode $first.NodePath) -or !(Test-DndPnpm $first.PnpmPath $first.PnpmVersion)) { throw 'Downloaded runtime unavailable.' }
    $second = Initialize-DndRuntime $projectRoot -ForcePortable -CheckOnly
    if ($second.NodePath -ne $first.NodePath -or $second.PnpmPath -ne $first.PnpmPath) { throw 'Cached runtime was not reused.' }
    Write-Host 'PASS: portable Node download/checksum, pinned pnpm installation and offline cache reuse.'
} finally { $runtimeJob.Dispose() }
