#!/bin/bash
# بناء كُنّاش وتوقيعه وتوثيقه وتغليفه — بأدوات macOS وحدها، بلا تبعية بناء واحدة.
#
#   build/release.sh            كل الخطوات
#   build/release.sh app        الحزمة والتوقيع فقط (بلا توثيق — للتجربة السريعة)
#   build/release.sh notarize   التوثيق والإلصاق وDMG (يفترض أن الحزمة موقّعة)
#
# ما يحتاجه مرة واحدة:
#   xcrun notarytool store-credentials "kunnash" \
#     --apple-id "<بريد حساب المطوّر>" --team-id "<معرّف الفريق>"
#
# يسأل عن كلمة المرور الخاصة بالتطبيق **تفاعليًا** ويحفظها في سلسلة المفاتيح،
# فلا تظهر في سكربت ولا في سجل أوامر ولا في متغيّر بيئة. وهذا سبب فصلها عن
# هذا الملف: السكربت يُنشر علنًا، والاعتماد لا يُنشر.

set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="كُنّاش"
EXEC_NAME="kunnash"
BUNDLE_ID="app.kunnash"
TEAM_ID="L432D2983H"
NOTARY_PROFILE="kunnash"
VERSION="$(node -p "require('./package.json').version")"

# المعمارية: arm64 افتراضًا، و`ARCH=x64 build/release.sh` لأجهزة إنتل.
# ملفان مستقلان لا حزمة عالمية: العالمية تُضاعف تنزيل **كل** مستخدم لأجل
# أقلية، وأكثر من يحمّل اليوم على معالج آبل. فيدفع كلٌّ ثمن نسخته وحدها.
ARCH="${ARCH:-arm64}"
case "$ARCH" in
  arm64) ARCH_LABEL="AppleSilicon" ;;
  x64)   ARCH_LABEL="Intel" ;;
  *)     printf '\033[31m✗ معمارية مجهولة: %s (arm64 أو x64)\033[0m\n' "$ARCH" >&2; exit 1 ;;
esac

DIST="dist/$ARCH"
APP="$DIST/$APP_NAME.app"
DMG="$DIST/Kunnash-$VERSION-$ARCH_LABEL.dmg"
# نسخة Electron لهذه المعمارية — تُنزَّل مرة وتُخزَّن
ELECTRON_VER="$(node -p "require('./node_modules/electron/package.json').version")"
ELECTRON_SRC="node_modules/electron/dist"
[ "$ARCH" = "arm64" ] || ELECTRON_SRC="build/.electron-$ARCH-$ELECTRON_VER"
ENTITLEMENTS="build/entitlements.plist"
IDENTITY="Developer ID Application: Nawaf Alsuwaiyed ($TEAM_ID)"
PB=/usr/libexec/PlistBuddy

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# PlistBuddy يفرّق بين Add وSet، وحزم Electron تنقصها مفاتيح لا نعرفها سلفًا
# (المساعدون مثلًا بلا CFBundleExecutable). فمدخلٌ واحد يضع القيمة كيفما كانت.
plist_put() {   # plist_put <ملف> <مفتاح> <قيمة>
  $PB -c "Set :$2 $3" "$1" >/dev/null 2>&1 || $PB -c "Add :$2 string $3" "$1" >/dev/null
}

# ————————————————————————————————— فحوص قبلية
preflight() {
  say "الفحص القبلي"

  security find-identity -v -p codesigning | grep -q "$IDENTITY" \
    || die "لا توجد شهادة «$IDENTITY» في سلسلة المفاتيح."
  echo "  ✓ الشهادة موجودة"

  [ -d node_modules/electron/dist/Electron.app ] \
    || die "Electron غير مثبّت. شغّل: npm install"

  # معمارية غير معمارية الجهاز: نجلب نسخة Electron الرسمية لها مرة واحدة
  if [ ! -d "$ELECTRON_SRC/Electron.app" ]; then
    say "جلب Electron $ELECTRON_VER لمعمارية $ARCH"
    local zip="build/.electron-$ARCH-$ELECTRON_VER.zip"
    curl -fL --progress-bar -o "$zip" \
      "https://github.com/electron/electron/releases/download/v$ELECTRON_VER/electron-v$ELECTRON_VER-darwin-$ARCH.zip" \
      || die "تعذّر جلب Electron لمعمارية $ARCH"
    rm -rf "$ELECTRON_SRC"; mkdir -p "$ELECTRON_SRC"
    ditto -x -k "$zip" "$ELECTRON_SRC" || die "تعذّر فكّ الأرشيف"
    rm -f "$zip"
  fi
  echo "  ✓ Electron $ELECTRON_VER · معمارية $ARCH"

  # لا نوقّع شيفرةً لم تجتز اختباراتها
  npm test >/dev/null 2>&1 || die "الاختبارات لم تمر. لا نوقّع شيفرة معطوبة."
  echo "  ✓ الاختبارات تمر"
}

# ————————————————————————————————— بناء الحزمة
stage() {
  say "بناء $APP_NAME.app — الإصدار $VERSION · $ARCH"

  rm -rf "$APP"
  mkdir -p "$DIST"
  cp -R "$ELECTRON_SRC/Electron.app" "$APP"

  local C="$APP/Contents"

  # ١) التنفيذي الرئيسي
  mv "$C/MacOS/Electron" "$C/MacOS/$EXEC_NAME"

  # ٢) المساعدات — Electron يشتقّ مسارها من اسم الحزمة، فتُعاد تسميتها معها
  local h
  for h in "" " (Renderer)" " (GPU)" " (Plugin)"; do
    local old="$C/Frameworks/Electron Helper$h.app"
    local new="$C/Frameworks/$APP_NAME Helper$h.app"
    mv "$old" "$new"
    mv "$new/Contents/MacOS/Electron Helper$h" "$new/Contents/MacOS/$APP_NAME Helper$h"
    # معرّف فرعي لكل مساعد: التنبيهات وActivity Monitor تنسبها للتطبيق لا لـElectron
    local suffix="${h//[ ()]/}"
    local hp="$new/Contents/Info.plist"
    plist_put "$hp" CFBundleExecutable "$APP_NAME Helper$h"
    plist_put "$hp" CFBundleName       "$APP_NAME Helper$h"
    plist_put "$hp" CFBundleIdentifier "$BUNDLE_ID.helper${suffix:+.$suffix}"
  done

  # ٣) الأيقونة
  node_modules/.bin/electron build/icon.js >/dev/null 2>&1
  cp dist/kunnash.icns "$C/Resources/$EXEC_NAME.icns"   # icon.js يكتب في dist/ لا في dist/$ARCH
  rm -f "$C/Resources/electron.icns"

  # ٤) شيفرة التطبيق — بلا node_modules، فلا تبعيات تشغيل أصلًا
  local APPDIR="$C/Resources/app"
  mkdir -p "$APPDIR"
  cp -R main.js preload.js package.json LICENSE lib renderer assets "$APPDIR/"

  # ٥) Info.plist
  local P="$C/Info.plist"
  plist_put "$P" CFBundleExecutable         "$EXEC_NAME"
  plist_put "$P" CFBundleIdentifier         "$BUNDLE_ID"
  plist_put "$P" CFBundleName               "$APP_NAME"
  plist_put "$P" CFBundleDisplayName        "$APP_NAME"
  plist_put "$P" CFBundleIconFile           "$EXEC_NAME"
  plist_put "$P" CFBundleShortVersionString "$VERSION"
  plist_put "$P" CFBundleVersion            "$VERSION"
  plist_put "$P" LSApplicationCategoryType  "public.app-category.productivity"
  plist_put "$P" NSHumanReadableCopyright   "كُنّاش — صدقة جارية · رخصة MIT"

  # نصوص أذونات TCC: تظهر في نافذة النظام حين يختار المستخدم مجلدًا محميًا.
  # بلا نص، تعرض macOS جملة عامة باردة — وهذه أول جملة يقرأها عن التطبيق.
  local why="ليقرأ كُنّاش ملفات مجلد العمل الذي تختاره ويكتب مخرجاته فيه."
  local k
  for k in NSDocumentsFolderUsageDescription NSDesktopFolderUsageDescription \
           NSDownloadsFolderUsageDescription NSRemovableVolumesUsageDescription; do
    plist_put "$P" "$k" "$why"
  done

  echo "  ✓ الحزمة: $(du -sh "$APP" | cut -f1)"
}

# ————————————————————————————————— التوقيع
sign_one() {
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$@" 2>&1 | grep -v "replacing existing signature" || true
}

sign() {
  say "التوقيع بـDeveloper ID"
  local F="$APP/Contents/Frameworks"
  local EF="$F/Electron Framework.framework/Versions/A"

  # من الداخل إلى الخارج: توقيع الأب يُبطل إن تغيّر ابنٌ بعده
  local lib
  for lib in "$EF/Libraries/"*.dylib; do sign_one "$lib"; done
  sign_one "$EF/Helpers/chrome_crashpad_handler"
  sign_one "$F/Squirrel.framework/Versions/A/Resources/ShipIt"
  sign_one "$EF"

  local fw
  for fw in Squirrel Mantle ReactiveObjC; do
    sign_one "$F/$fw.framework/Versions/A"
  done

  local h
  for h in "" " (Renderer)" " (GPU)" " (Plugin)"; do
    sign_one "$F/$APP_NAME Helper$h.app"
  done

  sign_one "$APP"

  # التحقق: --strict يرفض ما يقبله الفحص المتساهل
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
  echo "  ✓ التوقيع سليم"
}

# ————————————————————————————————— التوثيق
notarize() {
  say "التوثيق لدى آبل"

  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 || die \
"لا يوجد ملف اعتماد باسم «$NOTARY_PROFILE». أنشئه مرة واحدة:

  xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\
    --apple-id \"<بريد حساب المطوّر>\" --team-id \"$TEAM_ID\"

سيسألك عن كلمة المرور الخاصة بالتطبيق ويحفظها في سلسلة المفاتيح."

  local ZIP="$DIST/_notarize.zip"
  ditto -c -k --keepParent "$APP" "$ZIP"
  echo "  … أُرسل للفحص، وقد يستغرق دقائق"
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
  rm -f "$ZIP"

  xcrun stapler staple "$APP"
  echo "  ✓ التذكرة مُلصقة بالتطبيق"
}

# ————————————————————————————————— DMG
make_dmg() {
  say "صنع DMG"
  rm -f "$DMG"

  local STAGE="$DIST/_dmg"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"   # اسحب الأيقونة إلى هنا

  hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" \
    -ov -format UDZO -imagekey zlib-level=9 "$DMG" >/dev/null
  rm -rf "$STAGE"

  codesign --force --timestamp --sign "$IDENTITY" "$DMG"
  echo "  ✓ $DMG — $(du -sh "$DMG" | cut -f1)"
}

notarize_dmg() {
  say "توثيق DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
}

# ————————————————————————————————— التحقق الأخير
verify() {
  say "التحقق النهائي — بعين Gatekeeper"
  echo "التطبيق:"
  spctl -a -vvv -t exec "$APP" 2>&1 | sed 's/^/  /'
  xcrun stapler validate "$APP" 2>&1 | sed 's/^/  /'
  echo "DMG:"
  spctl -a -vvv -t open --context context:primary-signature "$DMG" 2>&1 | sed 's/^/  /'
  xcrun stapler validate "$DMG" 2>&1 | sed 's/^/  /'
}

case "${1:-all}" in
  app)      preflight; stage; sign ;;
  notarize) notarize; make_dmg; notarize_dmg; verify ;;
  all)      preflight; stage; sign; notarize; make_dmg; notarize_dmg; verify ;;
  *)        die "خطوة مجهولة: $1" ;;
esac

say "تمّ."
