$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ProjectDnd-launcher-qa-' + [Guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($testDir)
$owner = $null
$unrelated = $null
$nodePath = (Get-Command node.exe).Source

function Wait-Check([scriptblock]$Check, [string]$Message) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (& $Check)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw $Message }
        Start-Sleep -Milliseconds 100
    }
}

try {
    $fixture = Join-Path $testDir 'fixture.cjs'
    @'
const {writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {spawn}=require('node:child_process');
if(process.argv[2]==='child'){
  require('node:net').createServer().listen(0,'127.0.0.1',function(){
    writeFileSync(join(__dirname,'child.json'),JSON.stringify({pid:process.pid,port:this.address().port}));
  });
}else{
  spawn(process.execPath,[__filename,'child'],{stdio:'inherit'});
  writeFileSync(join(__dirname,'parent.json'),JSON.stringify({pid:process.pid}));
  setInterval(()=>{},1000);
}
'@ | Set-Content -LiteralPath $fixture -Encoding ASCII
    $ownerScript = Join-Path $testDir 'owner.ps1'
    $ownerText = @'
param($NativePath,$NodePath,$FixturePath,$Directory)
$ErrorActionPreference='Stop'
Add-Type -Path $NativePath
$job=New-Object ProjectDnd.LauncherJob
$process=$job.Start($NodePath,('"{0}" "{1}"' -f $NodePath,$FixturePath),$Directory)
try { while($true){Start-Sleep -Seconds 1} } finally { $job.Dispose() }
'@
    $ownerText | Set-Content -LiteralPath $ownerScript -Encoding ASCII
    $unrelated = Start-Process -FilePath $nodePath -ArgumentList '-e "setInterval(()=>{},1000)"' -WindowStyle Hidden -PassThru
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" "{1}" "{2}" "{3}" "{4}"' -f $ownerScript,(Join-Path $PSScriptRoot 'LauncherJob.cs'),$nodePath,$fixture,$testDir
    $owner = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $testDir 'error.txt')
    Wait-Check { Test-Path -LiteralPath (Join-Path $testDir 'child.json') } 'Managed child did not start.'
    $parentInfo = Get-Content -LiteralPath (Join-Path $testDir 'parent.json') -Raw | ConvertFrom-Json
    $childInfo = Get-Content -LiteralPath (Join-Path $testDir 'child.json') -Raw | ConvertFrom-Json
    if (-not (Get-Process -Id $parentInfo.pid,$childInfo.pid -ErrorAction SilentlyContinue)) { throw 'Fixture processes missing.' }

    # Abruptly terminate the owner: no finally handler can clean up for us.
    Stop-Process -Id $owner.Id -Force
    Wait-Check { -not (Get-Process -Id $parentInfo.pid,$childInfo.pid -ErrorAction SilentlyContinue) } 'A managed descendant survived its owner.'
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        try { $socket.Connect('127.0.0.1',$childInfo.port) } catch { }
        if ($socket.Connected) { throw 'Child port is still occupied.' }
    } finally { $socket.Dispose() }
    $unrelated.Refresh()
    if ($unrelated.HasExited) { throw 'An unrelated process was stopped.' }
    Write-Host 'PASS: abrupt owner exit stops child + grandchild and releases the port; unrelated process stays alive.'
} finally {
    foreach ($process in @($owner,$unrelated)) {
        if ($process) { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }; $process.Dispose() }
    }
    $resolvedTestDir = [System.IO.Path]::GetFullPath($testDir)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolvedTestDir.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestDir) -notmatch '^ProjectDnd-launcher-qa-[0-9a-f]{32}$') { throw 'Unexpected cleanup path.' }
    Remove-Item -LiteralPath $resolvedTestDir -Recurse -Force
}
