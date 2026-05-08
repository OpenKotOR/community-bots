#Requires -Version 7
<#
.SYNOPSIS
  Upload Cloudflare credentials to GitHub Actions secrets and trigger the Worker deploy workflow.

  Credential sources (first match wins; values never echoed):
    1) Environment variables CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
    2) Repo-root .env.cf.local (gitignored) — KEY=value lines, optional quotes

  Optional:
    GITHUB_REPOSITORY — default OpenKotOR/community-bots
    PAZAAK_WORKER_PUBLIC_URL in .env.cf.local — if set, syncs GitHub variables PAZAAK_API_BASES (Pages/Vite) and PAZAAK_WORKER_URL (matchmaking-inducer / Fly)
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repo = $env:GITHUB_REPOSITORY
if ([string]::IsNullOrWhiteSpace($repo)) {
  $repo = "OpenKotOR/community-bots"
}

$envFile = Join-Path $repoRoot ".env.cf.local"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^\s*#' -or $line.Length -eq 0) {
      return
    }
    if ($line -match '^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|PAZAAK_WORKER_PUBLIC_URL)=(.*)$') {
      $key = $Matches[1]
      $val = $Matches[2].Trim().Trim('"').Trim("'")
      if ($key -eq "CLOUDFLARE_API_TOKEN" -and [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
        $env:CLOUDFLARE_API_TOKEN = $val
      }
      if ($key -eq "CLOUDFLARE_ACCOUNT_ID" -and [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ACCOUNT_ID)) {
        $env:CLOUDFLARE_ACCOUNT_ID = $val
      }
      if ($key -eq "PAZAAK_WORKER_PUBLIC_URL" -and [string]::IsNullOrWhiteSpace($env:PAZAAK_WORKER_PUBLIC_URL)) {
        $env:PAZAAK_WORKER_PUBLIC_URL = $val
      }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
  Write-Error "CLOUDFLARE_API_TOKEN missing. Set env var or add to .env.cf.local (see .env.cf.local.example)."
}
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ACCOUNT_ID)) {
  Write-Error "CLOUDFLARE_ACCOUNT_ID missing. Set env var or add to .env.cf.local (see .env.cf.local.example)."
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh is not authenticated."
}

$env:CLOUDFLARE_API_TOKEN | gh secret set CLOUDFLARE_API_TOKEN --repo $repo
$env:CLOUDFLARE_ACCOUNT_ID | gh secret set CLOUDFLARE_ACCOUNT_ID --repo $repo

if (-not [string]::IsNullOrWhiteSpace($env:PAZAAK_WORKER_PUBLIC_URL)) {
  gh variable set PAZAAK_API_BASES --repo $repo --body $env:PAZAAK_WORKER_PUBLIC_URL
  gh variable set PAZAAK_WORKER_URL --repo $repo --body $env:PAZAAK_WORKER_PUBLIC_URL
}

gh workflow run "Deploy Pazaak Matchmaking Worker" --repo $repo
Start-Sleep -Seconds 4
$runId = (gh run list --repo $repo --workflow "Deploy Pazaak Matchmaking Worker" --limit 1 --json databaseId -q ".[0].databaseId")
if ([string]::IsNullOrWhiteSpace($runId)) {
  Write-Error "Could not resolve latest workflow run id."
}
gh run watch $runId --repo $repo --exit-status
