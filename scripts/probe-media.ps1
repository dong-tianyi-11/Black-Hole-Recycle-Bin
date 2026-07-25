# Returns Playing | Paused | None | Error:...
try {
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  while ($op.Status -eq 0) { Start-Sleep -Milliseconds 40 }
  if ($op.Status -ne 1) { Write-Output 'None'; exit 0 }
  $mgr = $op.GetResults()
  $session = $mgr.GetCurrentSession()
  if (-not $session) { Write-Output 'None'; exit 0 }
  $status = $session.GetPlaybackInfo().PlaybackStatus
  Write-Output $status.ToString()
} catch {
  Write-Output ("Error:" + $_.Exception.Message)
}
