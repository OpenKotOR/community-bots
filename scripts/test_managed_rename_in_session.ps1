$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"
$target = "/K1/k1_win_amazongames_swkotor.exe"
$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
function Escape-JsonString([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
}
$code = @'
addr = toAddr("004084b0")
fn = currentProgram.getFunctionManager().getFunctionAt(addr)
__result__ = {"name_after_manage_function": None if fn is None else str(fn.getName()), "changed": currentProgram.isChanged(), "modified_since_checkout": currentProgram.getDomainFile().modifiedSinceCheckout()}
'@
$seqJson = '[' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"manage-function","arguments":{"program_path":"' + (Escape-JsonString $target) + '","mode":"rename","function_identifier":"0x004084b0","new_name":"HandleWMCharMessage"}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $code) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "test-managed-rename-in-session.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
G:\cache\uv\archive-v0\GxDTu3HuJBUq7D-ufgvDT\Scripts\agentdecompile-cli.exe --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
