// اختبارات م٨: تكافؤ اللغتين، وأن كل مفتاح في الواجهة له نصّ.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../renderer/i18n');
const { STRINGS } = i18n;

const R = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');

describe('تكافؤ اللغتين', () => {
  // نصٌّ ناقص لا يُرى إلا عند تبديل اللغة، وقد لا يبدّلها المطوّر أبدًا.
  test('كل مفتاح يحمل عربية وإنجليزية غير فارغتين', () => {
    for (const [key, row] of Object.entries(STRINGS)) {
      assert.ok(Array.isArray(row) && row.length === 2, `«${key}» ليس زوجًا`);
      assert.ok(row[0] && row[0].trim(), `«${key}» بلا عربية`);
      assert.ok(row[1] && row[1].trim(), `«${key}» بلا إنجليزية`);
    }
  });

  test('لا نصّ إنجليزي فيه حروف عربية (ترجمة منسيّة)', () => {
    for (const [key, row] of Object.entries(STRINGS)) {
      assert.ok(!/[؀-ۿ]/.test(row[1]), `«${key}» إنجليزيته فيها عربية: ${row[1]}`);
    }
  });

  test('المتغيّرات {…} متطابقة في اللغتين', () => {
    const vars = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
    for (const [key, row] of Object.entries(STRINGS)) {
      assert.strictEqual(vars(row[0]), vars(row[1]), `«${key}» متغيّراته مختلفة`);
    }
  });
});

describe('الربط بالواجهة', () => {
  // مفتاح في HTML بلا نصّ في i18n يظهر للمستخدم كاسم المفتاح حرفيًا.
  test('كل data-i18n في index.html له مفتاح موجود', () => {
    const html = R('index.html');
    const used = new Set();
    for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) used.add(m[1]);
    assert.ok(used.size > 30, `الربط ضعيف: ${used.size} مفتاحًا فقط`);
    for (const key of used) {
      assert.ok(STRINGS[key], `«${key}» مستعمل في HTML وليس له نصّ`);
    }
  });

  test('كل i18n.t(\'…\') في app.js له مفتاح موجود', () => {
    const js = R('app.js');
    for (const m of js.matchAll(/i18n\.t\('([^']+)'/g)) {
      assert.ok(STRINGS[m[1]], `«${m[1]}» مستدعى في app.js وليس له نصّ`);
    }
  });

  // القلب يعتمد كليًا على الخصائص المنطقية: خاصية فيزيائية واحدة تكسره.
  test('لا خصائص فيزيائية في التنسيق (تكسر القلب)', () => {
    const css = R('style.css').replace(/\/\*[\s\S]*?\*\//g, '');   // بلا التعليقات
    const bad = css.match(/(?:^|[;{\s])(margin|padding|border)-(left|right)\s*:|text-align:\s*(left|right)\s*;/g);
    assert.strictEqual(bad, null, `وُجدت: ${bad && bad.join(' · ')}`);
  });
});

describe('السلوك', () => {
  test('t يرجع المفتاح نفسه إن كان مجهولًا — فيُرى في التجربة', () => {
    assert.strictEqual(i18n.t('لا-يوجد-هذا'), 'لا-يوجد-هذا');
  });

  test('الاستبدال يعمل في اللغتين', () => {
    i18n.setLang('ar');
    assert.match(i18n.t('greetingNamed', { name: 'نوّاف' }), /نوّاف/);
    i18n.setLang('en');
    assert.match(i18n.t('greetingNamed', { name: 'Nawaf' }), /^Welcome, Nawaf/);
    i18n.setLang('ar');
  });

  test('لغة مجهولة ترتدّ إلى العربية', () => {
    assert.strictEqual(i18n.setLang('fr'), 'ar');
    assert.strictEqual(i18n.dirOf('ar'), 'rtl');
    assert.strictEqual(i18n.dirOf('en'), 'ltr');
  });
});
