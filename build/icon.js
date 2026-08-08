// توليد أيقونة التطبيق (.icns) بلا أي تبعية.
//
// Electron موجود أصلًا للتطوير، وmacOS تحمل sips وiconutil — فلا حاجة
// لمكتبة رسم. نرسم icon.html في نافذة مخفية، نلتقطها بدقة 1024، ثم نصغّرها
// إلى مقاسات iconset ونجمعها.
//
//   node_modules/.bin/electron build/icon.js

const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'dist');
const ICONSET = path.join(OUT, 'kunnash.iconset');
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

// اسم الملف داخل iconset: المقاس ٣٢ يخدم 16@2x و32 معًا، وهكذا
const NAMES = {
  16: ['icon_16x16.png'],
  32: ['icon_16x16@2x.png', 'icon_32x32.png'],
  64: ['icon_32x32@2x.png'],
  128: ['icon_128x128.png'],
  256: ['icon_128x128@2x.png', 'icon_256x256.png'],
  512: ['icon_256x256@2x.png', 'icon_512x512.png'],
  1024: ['icon_512x512@2x.png'],
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });

  await win.loadFile(path.join(__dirname, 'icon.html'));
  // الخط يُحمَّل بعد الرسم الأول؛ بلا هذه المهلة يُلتقط بخط بديل
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage();
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });

  const master = path.join(OUT, 'icon-1024.png');
  fs.writeFileSync(master, image.toPNG());

  for (const size of SIZES) {
    const tmp = path.join(OUT, `_${size}.png`);
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), master, '--out', tmp], { stdio: 'ignore' });
    for (const name of NAMES[size]) fs.copyFileSync(tmp, path.join(ICONSET, name));
    fs.unlinkSync(tmp);
  }

  execFileSync('/usr/bin/iconutil', ['-c', 'icns', ICONSET, '-o', path.join(OUT, 'kunnash.icns')]);
  fs.rmSync(ICONSET, { recursive: true, force: true });

  const bytes = fs.statSync(path.join(OUT, 'kunnash.icns')).size;
  console.log(`✓ dist/kunnash.icns — ${(bytes / 1024).toFixed(0)} كيلوبايت`);
  app.exit(0);
});
