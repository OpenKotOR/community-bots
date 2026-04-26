param(
    [string]$TargetPath = "/K1/k1_win_amazongames_swkotor.exe",
    [string]$Comment = "Apply k1_win_gog metadata (names/comments/bookmarks) via semantic matching"
)
$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"

$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

function Escape-JsonString([string]$value) {
    if ($null -eq $value) { return "" }
    $v = $value.Replace('\', '\\')
    $v = $v.Replace('"', '\"')
    $v = $v.Replace("`r", '\r')
    $v = $v.Replace("`n", '\n')
    $v = $v.Replace("`t", '\t')
    return $v
}

# Read apply script code
$applyScriptPath = "C:/GitHub/openkotor-discord-bots/scripts/ghidra_apply_k1_metadata.py"
$applyCode = [System.IO.File]::ReadAllText($applyScriptPath, [System.Text.Encoding]::UTF8)

$seqJson = '[' +
    '{"name":"sync-project","arguments":{"mode":"pull","path":"' + (Escape-JsonString $TargetPath) + '","recursive":false,"force":true}},' +
    '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $TargetPath) + '","exclusive":true}},' +
    '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $TargetPath) + '","code":"' + (Escape-JsonString $applyCode) + '"}},' +
    '{"name":"checkin-program","arguments":{"program_path":"' + (Escape-JsonString $TargetPath) + '","comment":"' + (Escape-JsonString $Comment) + '","message":"' + (Escape-JsonString $Comment) + '"}}' +
    ']'

$safeName = $TargetPath -replace '[/\\]', '_' -replace '^_', ''
$seqPath = Join-Path $tmpDir "apply-single-$safeName.json"
[System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "==> Sequence JSON written to: $seqPath"
Write-Host "==> Target: $TargetPath"
Write-Host "==> Running tool-seq-file..."

uvx --refresh --from git+https://github.com/bolabaden/agentdecompile agentdecompile-cli `
    --ghidra-server-host 170.9.241.140 `
    --ghidra-server-port 13100 `
    --ghidra-server-username OpenKotOR `
    --ghidra-server-password revanlives `
    --ghidra-server-repository Odyssey `
    tool-seq-file $seqPath -f json
