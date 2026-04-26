$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"
$target = "/K1/k1_win_amazongames_swkotor.exe"
$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
function Escape-JsonString([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
}
$msg = "Test managed rename persist with sync save"
$seqJson = '[' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"manage-function","arguments":{"program_path":"' + (Escape-JsonString $target) + '","mode":"rename","function_identifier":"0x004084b0","new_name":"HandleWMCharMessage"}},' +
  '{"name":"sync-project","arguments":{"mode":"push","path":"' + (Escape-JsonString $target) + '","recursive":true,"force":true}},' +
  '{"name":"checkin-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","comment":"' + (Escape-JsonString $msg) + '","message":"' + (Escape-JsonString $msg) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "test-managed-rename-sync-checkin.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
uvx --refresh --from git+https://github.com/bolabaden/agentdecompile agentdecompile-cli --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
