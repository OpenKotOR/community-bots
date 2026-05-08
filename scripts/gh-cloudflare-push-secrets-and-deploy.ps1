#Requires -Version 7
<#
.SYNOPSIS
  Upload Cloudflare credentials to GitHub Actions secrets and trigger the Worker deploy workflow.

  Reads from environment (never from disk):
    CLOUDFLARE_API_TOKEN   - API token with Workers Scripts + Durable Objects deploy
    CLOUDFLARE_ACCOUNT_ID  - Cloudflare account id (32-char hex from dashboard)

  Optional:
    GITHUB_REPOSITORY      - default OpenKotOR/bots
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = $env:GITHUB_REPOSITORY
if ([string]::IsNullOrWhiteSpace($repo)) {
  $repo = "OpenKotOR/community-bots"
}

if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
  Write-Error "CLOUDFLARE_API_TOKEN is not set in the environment."
}
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_ACCOUNT_ID)) {
  Write-Error "CLOUDFLARE_ACCOUNT_ID is not set in the environment."
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh is not authenticated. Run: gh auth login"
}

$env:CLOUDFLARE_API_TOKEN | gh secret set CLOUDFLARE_API_TOKEN --repo $repo
$env:CLOUDFLARE_ACCOUNT_ID | gh secret set CLOUDFLARE_ACCOUNT_ID --repo $repo

gh workflow run "Deploy Pazaak Matchmaking Worker" --repo $repo
$runId = (gh run list --repo $repo --workflow "Deploy Pazaak Matchmaking Worker" --limit 1 --json databaseId -q ".[0].databaseId")
if ([string]::IsNullOrWhiteSpace($runId)) {
  Write-Error "Could not resolve latest workflow run id."
}
gh run watch $runId --repo $repo --exit-status
