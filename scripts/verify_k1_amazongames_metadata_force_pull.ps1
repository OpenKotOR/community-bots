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
__result__ = {
    "path": str(currentProgram.getDomainFile().getPathname()),
    "name_at_004084b0": None if fn is None else str(fn.getName()),
    "signature": None if fn is None else str(fn.getSignature()),
    "comment": None if fn is None else fn.getComment(),
    "is_checked_out": currentProgram.getDomainFile().isCheckedOut(),
    "modified_since_checkout": currentProgram.getDomainFile().modifiedSinceCheckout(),
}
'@
$seqJson = '[' +
  '{"name":"sync-project","arguments":{"mode":"pull","path":"' + (Escape-JsonString $target) + '","recursive":true,"force":true}},' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $code) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "verify-k1-amazongames-force-pull.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
uvx --refresh --from git+https://github.com/bolabaden/agentdecompile agentdecompile-cli --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
