param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$posRepo = $PSScriptRoot
$posRuntime = Join-Path $posRepo 'runtime/node.exe'
$posExpectedHash = 'BA4E6D110E8C1592A1ECD390F6B05F3DA124B13871A5BE62B341A07A853C6C32'
if ($NodePath) { Copy-Item -LiteralPath $NodePath -Destination $posRuntime }
if (-not (Test-Path -LiteralPath $posRuntime)) {
    Invoke-WebRequest 'https://nodejs.org/dist/v24.21.0/win-x64/node.exe' -OutFile $posRuntime
}
if ((Get-FileHash -LiteralPath $posRuntime -Algorithm SHA256).Hash -ne $posExpectedHash) { throw 'Node.js runtime hash mismatch' }
& $posRuntime --test (Join-Path $posRepo 'test.js')
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
$posCompiler = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $posCompiler /nologo /target:exe /platform:x64 /optimize+ ("/out:" + (Join-Path $posRepo 'POSレジを起動.exe')) (Join-Path $posRepo 'PosLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
$posVersion = (Get-Content -Raw -LiteralPath (Join-Path $posRepo 'package.json') | ConvertFrom-Json).version
$posDist = Join-Path $posRepo 'dist'
# A new staging directory avoids overwriting an earlier package or any user data.
$posStage = Join-Path $posDist ([Guid]::NewGuid().ToString())
$posApp = Join-Path $posStage 'POS試作'
New-Item -ItemType Directory -Path (Join-Path $posApp 'data'),(Join-Path $posApp 'runtime'),(Join-Path $posApp 'public') -Force | Out-Null
$posInclude = @('server.js','store.js','launcher.js','package.json','test.js','PosLauncher.cs','POSレジを起動.exe','起動.bat','起動.cmd','README.md','試用メモ.md','原画像との対応・未確認事項.md','起動エラーと更新手順.md')
foreach ($posFile in $posInclude) { Copy-Item -LiteralPath (Join-Path $posRepo $posFile) -Destination $posApp }
Copy-Item -Path (Join-Path $posRepo 'public/*') -Destination (Join-Path $posApp 'public')
Copy-Item -LiteralPath (Join-Path $posRepo 'sample/pos.json') -Destination (Join-Path $posApp 'data/pos.json')
Copy-Item -LiteralPath $posRuntime -Destination (Join-Path $posApp 'runtime/node.exe')
Copy-Item -LiteralPath (Join-Path $posRepo 'runtime/LICENSE-node.txt') -Destination (Join-Path $posApp 'runtime/LICENSE-node.txt')
$posZip = Join-Path $posDist ("nyushukka-pos-windows-$posVersion.zip")
if (Test-Path -LiteralPath $posZip) { throw 'Version already packaged. Increment package.json version before rebuilding.' }
Compress-Archive -LiteralPath $posApp -DestinationPath $posZip -CompressionLevel Optimal
Write-Output $posZip

