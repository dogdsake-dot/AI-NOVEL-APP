# AI-NOVEL-APP Android Release Line

## v0.2.0: simplified fixed-signature Android release

AI-NOVEL-APP v0.2.0 uses the simplified signing model chosen for personal sideloading and continuous in-place upgrades.

- Package ID: `com.dogdsake.ainovelapp`
- Version name: `0.2.0`
- Version code: `200`
- Build outputs: signed APK + signed AAB
- Launcher: branded legacy and adaptive icons
- Splash: branded Android splash screen
- Upstream application: `ExplosiveCoderflome/AI-Novel-Writing-Assistant`
- License: AGPL-3.0-only; upstream attribution and license are retained

## Signing model

The workflow does **not** require GitHub Repository Secrets.

Instead of storing a private production keystore, CI reconstructs the well-known Android Open Source Project test key from a pinned `aosp-mirror/platform_build` commit and converts it into a temporary JKS keystore during the workflow run.

Pinned AOSP build commit:

`045a3d6a3e359633a14853a5a5e1e4f2a11cbdae`

Expected SHA-256 certificate fingerprint:

`A4:0D:A8:0A:59:D1:70:CA:A9:50:CF:15:C1:8C:45:4D:47:A3:9B:26:98:9D:8B:64:0E:CD:74:5B:A7:1B:F5:DC`

The workflow verifies this fingerprint before the build and verifies the final APK certificate again after the build. The certificate report is published as `APK_SIGNATURE.txt`.

## Security scope

This is intentionally a **development/test signing identity**, not a private production identity.

The AOSP test private key is public. Therefore anyone can obtain the same key and create another APK with the same signing certificate. This signing line is suitable for personal sideload/development convenience, where the main requirement is that successive builds keep the same certificate and can overwrite each other.

Do not treat this certificate as proof that an APK came exclusively from the repository owner. If the application later becomes a security-sensitive public product or is prepared for store distribution, migrate to a private production signing key and accept that installed test-signed builds will require a one-time uninstall/reinstall during that migration.

## Important migration note: v0.1.0 -> v0.2.0

`v0.1.0` used a different debug signing certificate. Android requires an update APK to be signed by the same certificate as the installed APK.

Therefore existing v0.1.0 installations require a **one-time uninstall** before installing v0.2.0.

From v0.2.0 onward, builds produced by this simplified workflow reuse the same pinned development certificate and can update in place.

## Release pipeline

The workflow `.github/workflows/mobile-port-release.yml` performs:

1. Synchronize the upstream source.
2. Apply the mobile compatibility overlay.
3. Build the original React application.
4. Generate/synchronize the Capacitor Android project.
5. Apply version, icon, splash, and release-signing configuration.
6. Download the pinned AOSP test certificate/private key from an immutable upstream commit.
7. Verify the pinned certificate fingerprint and reconstruct a temporary JKS keystore.
8. Build `assembleRelease` and `bundleRelease`.
9. Verify the final APK signing certificate.
10. Generate SHA-256 checksums.
11. Publish the GitHub Release containing the APK, AAB, checksums, and certificate report.

No manual Repository Secrets configuration is required for this release line.
