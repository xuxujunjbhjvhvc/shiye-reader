param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $sourceRoot 'release\拾页' }
$packageRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$taskBuildRoot = Join-Path $sourceRoot '.build'
New-Item -ItemType Directory -Path (Join-Path $taskBuildRoot 'temp') -Force | Out-Null
$env:TEMP = Join-Path $taskBuildRoot 'temp'
$env:TMP = $env:TEMP
if ([string]::IsNullOrWhiteSpace($env:npm_config_cache)) { $env:npm_config_cache = Join-Path $taskBuildRoot 'npm-cache' }
$sdkVersion = '1.0.3719.77'
$sdkRoot = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.web.webview2\$sdkVersion"
if (!(Test-Path -LiteralPath $sdkRoot)) {
    $sdkRoot = Join-Path $taskBuildRoot 'webview2'
    if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
        New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
        $zipPath = Join-Path $taskBuildRoot 'webview2.zip'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" -OutFile $zipPath
        Expand-Archive -LiteralPath $zipPath -DestinationPath $sdkRoot -Force
    }
}
Push-Location $sourceRoot
try {
    npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
    $appPath = [System.IO.Path]::GetFullPath((Join-Path $packageRoot 'app'))
    if ((Split-Path $appPath -Parent) -ne $packageRoot) { throw 'Unexpected app target' }
    if (Test-Path -LiteralPath $appPath) { Remove-Item -LiteralPath $appPath -Recurse -Force }
    New-Item -ItemType Directory -Path $appPath | Out-Null
    Copy-Item -Path 'dist\*' -Destination $appPath -Recurse -Force
    Copy-Item -LiteralPath 'public\favicon.ico' -Destination (Join-Path $packageRoot '拾页.ico') -Force
    Copy-Item -Path "$sdkRoot\lib\net462\Microsoft.Web.WebView2.Core.dll","$sdkRoot\lib\net462\Microsoft.Web.WebView2.WinForms.dll","$sdkRoot\runtimes\win-x64\native\WebView2Loader.dll" -Destination $packageRoot -Force
    Copy-Item -LiteralPath "$PSScriptRoot\Reader.exe.config" -Destination (Join-Path $packageRoot '拾页.exe.config') -Force
    Copy-Item -LiteralPath 'LICENSE' -Destination $packageRoot -Force
    Copy-Item -LiteralPath 'README.md' -Destination $packageRoot -Force
    Copy-Item -LiteralPath 'licenses' -Destination $packageRoot -Recurse -Force
    foreach ($name in @('LICENSE.txt', 'NOTICE.txt')) {
        Copy-Item -LiteralPath (Join-Path $sdkRoot $name) -Destination (Join-Path $packageRoot "licenses\WebView2-$name") -Force
    }
    $compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /utf8output "/out:$packageRoot\拾页.exe" "/win32icon:$packageRoot\拾页.ico" "/win32manifest:$PSScriptRoot\Reader.exe.manifest" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/reference:$packageRoot\Microsoft.Web.WebView2.Core.dll" "/reference:$packageRoot\Microsoft.Web.WebView2.WinForms.dll" "$PSScriptRoot\Reader.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
    Write-Host "Built $packageRoot"
} finally {
    Pop-Location
}
