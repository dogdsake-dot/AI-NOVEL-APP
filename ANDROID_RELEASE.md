# AI-NOVEL-APP Android Release Line

## v0.2.0: first long-term signed release

AI-NOVEL-APP v0.2.0 starts the persistent Android release-signing line.

- Package ID: `com.dogdsake.ainovelapp`
- Version name: `0.2.0`
- Version code: `200`
- Build outputs: signed APK + signed AAB
- Launcher: branded legacy and adaptive icons
- Splash: branded Android splash screen
- Upstream application: `ExplosiveCoderflome/AI-Novel-Writing-Assistant`
- License: AGPL-3.0-only; upstream attribution and license are retained

## Important migration note: v0.1.0 -> v0.2.0

`v0.1.0` was built with Android's debug signing certificate. `v0.2.0` uses a new persistent release certificate.

Android requires an update APK to be signed by the same certificate as the installed APK. Therefore existing v0.1.0 test installations require a **one-time uninstall** before installing v0.2.0.

From v0.2.0 onward, releases can update in place as long as this exact release keystore is preserved and used for every future version.

The package ID remains fixed so the application identity is stable from the formal release line onward.

## Release certificate

Expected SHA-256 certificate fingerprint for the v0.2.0 release line:

`58:6D:14:84:E0:C5:87:67:28:8F:B8:BD:BE:85:9E:C6:BF:F6:C6:B8:C0:22:64:F2:1A:3C:AA:A3:C5:42:06:E4`

Every formal Android release should be checked against this fingerprint. The CI workflow also runs `apksigner verify --print-certs` and publishes the result as `APK_SIGNATURE.txt`.

## GitHub Actions secrets

The private keystore is intentionally **not stored in this public repository**. The release workflow reads these repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

To configure them on Windows after securely extracting the signing backup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-android-signing.ps1 `
  -SecretsFile "C:\secure\AI-NOVEL-APP-signing\GITHUB_SECRETS.txt" `
  -TriggerRelease
```

The script requires GitHub CLI (`gh`) and an authenticated session (`gh auth login`). Secret values are sent to GitHub Actions without being printed to the terminal.

## Key custody

The release keystore is part of the application's long-term identity. Losing it means later APKs cannot update existing installations signed by this certificate.

Keep at least two encrypted/offline backups of the original `.jks` and its credentials. Never commit the `.jks`, Base64 keystore, passwords, or `GITHUB_SECRETS.txt` to the repository.

## Stable release pipeline

The workflow `.github/workflows/mobile-port-release.yml` performs:

1. Synchronize the upstream source.
2. Apply the mobile compatibility overlay.
3. Build the original React application.
4. Generate/synchronize the Capacitor Android project.
5. Apply version, icon, splash, and release-signing configuration.
6. Validate the persistent signing keystore from GitHub Actions secrets.
7. Build `assembleRelease` and `bundleRelease`.
8. Verify the APK signing certificate.
9. Generate SHA-256 checksums.
10. Publish a stable GitHub Release containing the APK, AAB, checksums, and certificate report.
