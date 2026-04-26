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
objs = {"program": currentProgram, "df": currentProgram.getDomainFile()}
try:
    objs["parent"] = currentProgram.getDomainFile().getParent()
except Exception:
    pass
result = {}
for key, obj in objs.items():
    methods = []
    for m in obj.getClass().getMethods():
        n = m.getName().lower()
        if "modif" in n or "chang" in n or "dirty" in n or "checkout" in n:
            methods.append(str(m))
    methods.sort()
    result[key] = {"class": str(obj.getClass()), "methods": methods[:200]}
__result__ = result
'@
$seqJson = '[' +
  '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
  '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $code) + '"}}' +
  ']'
$seqPath = Join-Path $tmpDir "probe-modified-methods.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))
G:\cache\uv\archive-v0\GxDTu3HuJBUq7D-ufgvDT\Scripts\agentdecompile-cli.exe --ghidra-server-host 170.9.241.140 --ghidra-server-port 13100 --ghidra-server-username OpenKotOR --ghidra-server-password revanlives --ghidra-server-repository Odyssey tool-seq-file $seqPath -f json
