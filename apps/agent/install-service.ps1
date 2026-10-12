# Run from an elevated PowerShell after publishing. Enroll with the installed executable before starting the service.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PublishDirectory)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $PublishDirectory).Path
$sourceExe = Join-Path $source 'DeskPilot.Agent.Service.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw 'Publish the Windows service before installation.' }
if (Get-Service -Name DeskPilotAgent -ErrorAction SilentlyContinue) { throw 'DeskPilotAgent is already installed. Stop and update the existing installation explicitly.' }
$destination = Join-Path $env:ProgramFiles 'DeskPilot\Agent'
if (Test-Path -LiteralPath $destination) { throw 'The destination already exists. Review the existing files before installation.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath (Get-ChildItem -LiteralPath $source | Select-Object -ExpandProperty FullName) -Destination $destination -Recurse
$exe = Join-Path $destination 'DeskPilot.Agent.Service.exe'
$serviceCredential = [pscredential]::new('NT AUTHORITY\LocalService', [securestring]::new())
New-Service -Name DeskPilotAgent -DisplayName 'DeskPilot Agent' -BinaryPathName ('"' + $exe + '" run') -StartupType Automatic -Credential $serviceCredential -Description 'Reports enrolled device inventory and heartbeat to DeskPilot.' | Out-Null
Write-Host 'Service installed as LocalService. Complete enrollment using the installed executable, then run Start-Service DeskPilotAgent.'
