$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"
$target = "/K1/k1_win_amazongames_swkotor.exe"
$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
function Escape-JsonString([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
}
$applyCode = Get-Content -Raw "scripts/ghidra_apply_k1_metadata.py"
$saveProbe = @'
result={"changed_before": None, "can_save_before": None, "save_ok": False, "error_class": None, "error_message": None, "changed_after": None, "can_save_after": None}
try:
    result["changed_before"] = currentProgram.isChanged()
    result["can_save_before"] = currentProgram.canSave()
    currentProgram.save("probe save after audited apply", monitor)
    result["save_ok"] = True
except Exception as e:
    result["error_class"] = e.__class__.__name__
    result["error_message"] = str(e)
try:
    result["changed_after"] = currentProgram.isChanged()
    result["can_save_after"] = currentProgram.canSave()
except Exception as e:
    result["post_error"] = str(e)
__result__ = result
'@
$seqJson = '[' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $applyCode) + '"}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $saveProbe) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "probe-apply-save-error.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
uvx --refresh --from git+https://github.com/bolabaden/agentdecompile agentdecompile-cli --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
