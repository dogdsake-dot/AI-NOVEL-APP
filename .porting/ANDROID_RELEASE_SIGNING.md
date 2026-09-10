# Android release signing

AI-NOVEL-APP v0.2.0+ uses a persistent Android release certificate so later APKs can upgrade the installed app in place.

The package id is permanently kept as `com.dogdsake.ainovelapp` because v0.1.0 already used that id.

## Required GitHub Actions secrets

The release workflow intentionally refuses to publish if any signing secret is missing. Add these repository secrets in GitHub Settings → Secrets and variables → Actions:

- `ANDROID_KEYSTORE_BASE64` — base64 of the long-term `.jks` keystore
- `ANDROID_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_KEY_ALIAS` — signing key alias
- `ANDROID_KEY_PASSWORD` — signing key password

Never commit the keystore or passwords to this public repository.

## Generate a long-term key once

Example (run locally and keep the resulting JKS backed up offline):

```bash
keytool -genkeypair -v -keystore ai-novel-release.jks -alias ai-novel -keyalg RSA -keysize 4096 -validity 10000
```

Encode the keystore for the GitHub secret:

Linux/macOS:

```bash
base64 -w 0 ai-novel-release.jks
```

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('ai-novel-release.jks'))
```

Keep the original keystore and passwords outside GitHub. Losing this signing key means future versions cannot update installations signed by it.

## Release verification

The CI pipeline builds `assembleRelease` and `bundleRelease`, verifies the APK with Android `apksigner`, and publishes the certificate report plus SHA-256 checksums with each stable GitHub Release.
