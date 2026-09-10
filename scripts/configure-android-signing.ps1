[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SecretsFile,

    [string]$Repository = "dogdsake-dot/AI-NOVEL-APP",

    [switch]$TriggerRelease
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install GitHub CLI first: winget install --id GitHub.cli"
    }
}

Require-Command "gh"

& gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run: gh auth login"
}

$resolved = Resolve-Path $SecretsFile
$required = @(
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEY_PASSWORD"
)

$values = @{}
foreach ($line in Get-Content -LiteralPath $resolved -Encoding UTF8) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) {
        continue
    }

    $index = $line.IndexOf("=")
    if ($index -lt 1) {
        continue
    }

    $name = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1)
    if ($required -contains $name) {
        $values[$name] = $value
    }
}

$missing = @($required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) })
if ($missing.Count -gt 0) {
    throw "Signing backup is missing required value(s): $($missing -join ', ')"
}

Write-Host "Configuring Android release signing secrets for $Repository ..."
foreach ($name in $required) {
    $value = $values[$name]
    $value | & gh secret set $name --repo $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set GitHub Actions secret: $name"
    }
    Write-Host "  configured: $name"
}

Write-Host "All four signing secrets were configured without printing their values."

if ($TriggerRelease) {
    Write-Host "Triggering Mobile Android release workflow on main ..."
    & gh workflow run mobile-port-release.yml --repo $Repository --ref main
    if ($LASTEXITCODE -ne 0) {
        throw "Secrets were configured, but triggering the workflow failed. You can run it manually from GitHub Actions."
    }
    Write-Host "Release workflow triggered."
} else {
    Write-Host "To publish v0.2.0 now, run:"
    Write-Host "  gh workflow run mobile-port-release.yml --repo $Repository --ref main"
}

Write-Host "IMPORTANT: keep the original .jks/signing backup permanently. Future Android updates must use the same certificate."
