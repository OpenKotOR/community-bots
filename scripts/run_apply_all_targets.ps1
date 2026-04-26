param(
    [string]$Comment = "Apply k1_win_gog metadata (names/comments/bookmarks) via semantic matching",
    [string]$AgentDecompileRef = "git+https://github.com/bolabaden/agentdecompile@485010304851b7a15021f288780caa2a2b1c9883"
)

$ErrorActionPreference = 'Continue'
$Env:GHIDRA_INSTALL_DIR = "C:/ghidra12/ghidra_12.0.4_PUBLIC"

$targets = @(
    "/K1/k1_android_ARM64",
    "/K1/k1_android_ARMEABI",
    "/K1/k1_iOS_KOTOR.ipa",
    "/K1/k1_mac_swkotor.app",
    "/K1/k1_win_amazongames_swkotor.exe",
    "/K1/k1_win_gog_swkotor.exe.keep",
    "/K1/k1_xbox_default.xbe",
    "/TSL/k2_ios_KOTOR_II.ipa",
    "/TSL/k2_linux_swkotor2.elf",
    "/TSL/k2_mac_swkotor2.app",
    "/TSL/k2_win_CD_1.0_swkotor2.exe",
    "/TSL/k2_win_CD_1.0b_swkotor2.exe",
    "/TSL/k2_win_gog_aspyr_swkotor2.exe",
    "/TSL/k2_win_steam_aspyr_swkotor2.exe",
    "/TSL/k2_xbox_default.xbe",
    "/JE/JadeEmpire.exe",
    "/Other BioWare Engines/Aurora/nwmain.exe",
    "/Other BioWare Engines/Eclipse/daorigins.exe",
    "/Other BioWare Engines/Eclipse/DragonAge2.exe"
)

$tmpDir = "C:/GitHub/openkotor-discord-bots/scripts/.tmp"
$auditDir = "C:/GitHub/openkotor-discord-bots/scripts/metadata-audit"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
New-Item -ItemType Directory -Path $auditDir -Force | Out-Null

function Escape-JsonString([string]$value) {
    if ($null -eq $value) { return "" }
    $v = $value.Replace('\', '\\')
    $v = $v.Replace('"', '\"')
    $v = $v.Replace("`r", '\r')
    $v = $v.Replace("`n", '\n')
    $v = $v.Replace("`t", '\t')
    return $v
}

$applyScriptPath = "C:/GitHub/openkotor-discord-bots/scripts/ghidra_apply_k1_metadata.py"
$applyCode = [System.IO.File]::ReadAllText($applyScriptPath, [System.Text.Encoding]::UTF8)
$timestamp = Get-Date -Format "yyyyMMddTHHmmss"
$summaryPath = Join-Path $auditDir "batch_apply_summary_$timestamp.json"
$results = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
    $safeName = $target -replace '[/\\]', '_' -replace '^_', ''
    $seqPath = Join-Path $tmpDir "apply-$safeName.json"
    $outputPath = Join-Path $tmpDir "apply-$safeName-output.json"
    $seqJson = '[' +
        '{"name":"sync-project","arguments":{"mode":"pull","path":"' + (Escape-JsonString $target) + '","recursive":false,"force":true}},' +
        '{"name":"checkout-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","exclusive":true}},' +
        '{"name":"execute-script","arguments":{"program_path":"' + (Escape-JsonString $target) + '","code":"' + (Escape-JsonString $applyCode) + '"}},' +
        '{"name":"checkin-program","arguments":{"program_path":"' + (Escape-JsonString $target) + '","comment":"' + (Escape-JsonString $Comment) + '","message":"' + (Escape-JsonString $Comment) + '"}}' +
        ']'
    [System.IO.File]::WriteAllText($seqPath, $seqJson, [System.Text.UTF8Encoding]::new($false))

    Write-Host "==> [$target] starting"
    $output = & uvx --from $AgentDecompileRef agentdecompile-cli `
        --ghidra-server-host 170.9.241.140 `
        --ghidra-server-port 13100 `
        --ghidra-server-username OpenKotOR `
        --ghidra-server-password revanlives `
        --ghidra-server-repository Odyssey `
        tool-seq-file $seqPath -f json 2>&1
    $outputText = ($output | Out-String)
    [System.IO.File]::WriteAllText($outputPath, $outputText, [System.Text.UTF8Encoding]::new($false))

    $success = $false
    $mapped = $null
    $renamed = $null
    $auditPath = $null
    $errorSummary = $null
    try {
        $match = [regex]::Match($outputText, '(?s)\{\s*"success".*\}\s*$')
        if ($match.Success) {
            $parsed = $match.Value | ConvertFrom-Json -Depth 100
            $success = [bool]$parsed.success
            foreach ($step in $parsed.steps) {
                if ($step.name -eq 'execute-script') {
                    $textBlocks = @($step.result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text })
                    $joined = ($textBlocks -join "`n")
                    $auditMatch = [regex]::Match($joined, 'audit_path:\s*([^,\r\n}]+)')
                    $mappedMatch = [regex]::Match($joined, 'mapped:\s*(\d+)')
                    $renamedMatch = [regex]::Match($joined, 'renamed:\s*(\d+)')
                    if ($auditMatch.Success) { $auditPath = $auditMatch.Groups[1].Value.Trim() }
                    if ($mappedMatch.Success) { $mapped = [int]$mappedMatch.Groups[1].Value }
                    if ($renamedMatch.Success) { $renamed = [int]$renamedMatch.Groups[1].Value }
                }
                if (-not $step.success -and -not $errorSummary) {
                    $errorSummary = ($step.result.content | ForEach-Object { $_.text } | Out-String).Trim()
                }
            }
        }
    }
    catch {
        $errorSummary = $_.Exception.Message
    }

    $result = [pscustomobject]@{
        target = $target
        success = $success
        mapped = $mapped
        renamed = $renamed
        audit_path = $auditPath
        output_path = $outputPath
        error = $errorSummary
    }
    $results.Add($result) | Out-Null

    if ($success) {
        Write-Host "==> [$target] success mapped=$mapped renamed=$renamed"
    }
    else {
        Write-Warning "[$target] failed"
    }

    $results | ConvertTo-Json -Depth 8 | Set-Content -Path $summaryPath -Encoding UTF8
}

Write-Host "==> Batch summary: $summaryPath"
$results | ConvertTo-Json -Depth 8
