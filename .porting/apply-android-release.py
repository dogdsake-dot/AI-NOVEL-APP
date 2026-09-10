from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ANDROID_APP = ROOT / "mobile/android/app"
VERSION = (ROOT / ".porting/mobile-version.txt").read_text().strip()

m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", VERSION)
if not m:
    raise SystemExit(f"Release version must be plain semver, got: {VERSION}")
major, minor, patch = map(int, m.groups())
VERSION_CODE = major * 10000 + minor * 100 + patch
if VERSION_CODE <= 1:
    raise SystemExit("v0.2.0+ release must have versionCode > 1")

build_gradle = ANDROID_APP / "build.gradle"
text = build_gradle.read_text()
text = re.sub(r'versionCode\s+\d+', f'versionCode {VERSION_CODE}', text)
text = re.sub(r'versionName\s+"[^"]+"', f'versionName "{VERSION}"', text)

if "AI_NOVEL_RELEASE_STORE_FILE" not in text:
    signing = '''    signingConfigs {
        release {
            def storePath = System.getenv("AI_NOVEL_RELEASE_STORE_FILE")
            def storePass = System.getenv("AI_NOVEL_RELEASE_STORE_PASSWORD")
            def keyAliasValue = System.getenv("AI_NOVEL_RELEASE_KEY_ALIAS")
            def keyPass = System.getenv("AI_NOVEL_RELEASE_KEY_PASSWORD")
            if (storePath && storePass && keyAliasValue && keyPass) {
                storeFile file(storePath)
                storePassword storePass
                keyAlias keyAliasValue
                keyPassword keyPass
                v1SigningEnabled true
                v2SigningEnabled true
                v3SigningEnabled true
                v4SigningEnabled true
            }
        }
    }
'''
    text = text.replace("    buildTypes {\n", signing + "    buildTypes {\n", 1)
    text = text.replace("        release {\n", "        release {\n            signingConfig signingConfigs.release\n", 1)

build_gradle.write_text(text)

values = ANDROID_APP / "src/main/res/values"
drawable = ANDROID_APP / "src/main/res/drawable"
v31 = ANDROID_APP / "src/main/res/values-v31"
adaptive = ANDROID_APP / "src/main/res/mipmap-anydpi-v26"
for p in (values, drawable, v31, adaptive):
    p.mkdir(parents=True, exist_ok=True)

(values / "strings.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">AI Novel App</string>
    <string name="title_activity_main">AI Novel App</string>
    <string name="package_name">com.dogdsake.ainovelapp</string>
    <string name="custom_url_scheme">com.dogdsake.ainovelapp</string>
</resources>
''')

(values / "colors.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#17112C</color>
    <color name="colorPrimaryDark">#090B16</color>
    <color name="colorAccent">#57D7D0</color>
    <color name="ai_novel_background">#090B16</color>
    <color name="ai_novel_icon_background">#17112C</color>
</resources>
''')

(drawable / "ai_novel_launcher_foreground.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#EEE9DA" android:pathData="M20,39 C31,34 42,35 52,41 L52,76 C42,70 31,69 20,73 Z"/>
    <path android:fillColor="#D9D2C4" android:pathData="M88,39 C77,34 66,35 56,41 L56,76 C66,70 77,69 88,73 Z"/>
    <path android:fillColor="#57D7D0" android:pathData="M54,23 C47,31 46,38 50,44 C53,48 55,51 54,56 C53,61 49,65 45,68 C54,67 61,62 63,55 C65,49 61,45 58,41 C55,37 56,33 59,29 C60,26 59,24 54,23 Z"/>
    <path android:fillColor="#8B6CFF" android:pathData="M47,57 C40,59 36,63 36,68 C35,72 37,76 42,78 C41,74 43,71 46,69 C50,66 51,62 47,57 Z"/>
    <path android:fillColor="#8B6CFF" android:pathData="M61,57 C68,59 72,63 72,68 C73,72 71,76 66,78 C67,74 65,71 62,69 C58,66 57,62 61,57 Z"/>
    <path android:fillColor="#F5F0E7" android:pathData="M52,28 A2,2 0,1 0,56 28 A2,2 0,1 0,52 28"/>
</vector>
''')

(drawable / "ai_novel_logo.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="144dp" android:height="144dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#EEE9DA" android:pathData="M20,39 C31,34 42,35 52,41 L52,76 C42,70 31,69 20,73 Z"/>
    <path android:fillColor="#D9D2C4" android:pathData="M88,39 C77,34 66,35 56,41 L56,76 C66,70 77,69 88,73 Z"/>
    <path android:fillColor="#57D7D0" android:pathData="M54,23 C47,31 46,38 50,44 C53,48 55,51 54,56 C53,61 49,65 45,68 C54,67 61,62 63,55 C65,49 61,45 58,41 C55,37 56,33 59,29 C60,26 59,24 54,23 Z"/>
    <path android:fillColor="#8B6CFF" android:pathData="M47,57 C40,59 36,63 36,68 C35,72 37,76 42,78 C41,74 43,71 46,69 C50,66 51,62 47,57 Z"/>
    <path android:fillColor="#8B6CFF" android:pathData="M61,57 C68,59 72,63 72,68 C73,72 71,76 66,78 C67,74 65,71 62,69 C58,66 57,62 61,57 Z"/>
</vector>
''')

(drawable / "splash.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/ai_novel_background"/>
    <item android:gravity="center" android:width="144dp" android:height="144dp" android:drawable="@drawable/ai_novel_logo"/>
</layer-list>
''')

styles = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
    </style>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/ai_novel_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/ai_novel_logo</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:background">@drawable/splash</item>
    </style>
</resources>
'''
(values / "styles.xml").write_text(styles)
(v31 / "styles.xml").write_text(styles)

adaptive_xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ai_novel_icon_background"/>
    <foreground android:drawable="@drawable/ai_novel_launcher_foreground"/>
</adaptive-icon>
'''
(adaptive / "ic_launcher.xml").write_text(adaptive_xml)
(adaptive / "ic_launcher_round.xml").write_text(adaptive_xml)

manifest = ANDROID_APP / "src/main/AndroidManifest.xml"
manifest_text = manifest.read_text()
manifest_text = manifest_text.replace('android:allowBackup="true"', 'android:allowBackup="true"\n        android:fullBackupContent="false"')
manifest.write_text(manifest_text)

print(f"Applied Android v{VERSION} release configuration; versionCode={VERSION_CODE}")
