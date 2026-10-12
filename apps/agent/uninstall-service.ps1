[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$service = Get-Service -Name DeskPilotAgent -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') { Stop-Service -Name DeskPilotAgent }
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    & sc.exe delete DeskPilotAgent
    if ($LASTEXITCODE -ne 0) { throw 'Windows could not remove the service registration.' }
}
Write-Host 'Service registration removed. Revoke the device in DeskPilot. Binaries and protected identity data are retained for explicit administrator cleanup.'
