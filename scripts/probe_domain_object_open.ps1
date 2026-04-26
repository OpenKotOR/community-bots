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
from java.lang import Object as JavaObject
from ghidra.util.task import TaskMonitor
result = {"opened": False}
df = currentProgram.getDomainFile()
consumer = JavaObject()
last = None
program2 = None
for args in [(consumer, True, False, monitor), (consumer, True, monitor), (consumer, False, monitor), (consumer, monitor), (consumer, True, False), (consumer, True), (consumer,)]:
    try:
        program2 = df.getDomainObject(*args)
        result["opened"] = True
        result["args_len"] = len(args)
        break
    except Exception as e:
        last = str(e)
result["last_error"] = last
if program2 is not None:
    result["same_object"] = program2 is currentProgram
    result["class"] = str(program2.getClass())
    result["can_save"] = program2.canSave()
    result["is_changed"] = program2.isChanged()
    try:
        tx = program2.getCurrentTransactionInfo()
        result["tx"] = None if tx is None else {"id": int(tx.getID()), "description": str(tx.getDescription())}
    except Exception as e:
        result["tx_error"] = str(e)
    try:
        program2.release(consumer)
        result["released"] = True
    except Exception as e:
        result["release_error"] = str(e)
__result__ = result
'@
$seqJson = '[' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $code) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "probe-domain-object-open.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
uvx --refresh --from git+https://github.com/bolabaden/agentdecompile agentdecompile-cli --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
