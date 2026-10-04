# Local Windows build helper. Changes environment only for this process.
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CargoArgs)
$ErrorActionPreference = 'Stop'
$devCmd = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
if (!(Test-Path -LiteralPath $devCmd)) { throw 'VS2022 Build Tools not found; run from an x64 Developer PowerShell or configure your installed VS path.' }
$previousPassing = $PSNativeCommandArgumentPassing
try {
    $PSNativeCommandArgumentPassing = 'Legacy'
    $vars = & "$env:SystemRoot\System32\cmd.exe" /d /c "call `"$devCmd`" -no_logo -arch=x64 -host_arch=x64 && set"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to load VS2022 x64 environment.' }
    foreach ($line in $vars) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
    }
} finally { $PSNativeCommandArgumentPassing = $previousPassing }
$desktop = Split-Path -Parent $PSScriptRoot
$temp = Join-Path $desktop 'target\build-tmp'
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$env:TEMP = $temp
$env:TMP = $temp
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Push-Location -LiteralPath $desktop
try { & "$env:USERPROFILE\.cargo\bin\cargo.exe" @CargoArgs; $result = $LASTEXITCODE }
finally { Pop-Location }
exit $result
