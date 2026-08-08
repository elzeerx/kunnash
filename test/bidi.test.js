// اختبارات م٧: اتجاه الأساس بالغلبة — الحالات التي يراها المستخدم فعلًا.

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { baseDir } = require('../renderer/bidi');

describe('الغلبة لا أول حرف — وهذا كل الفرق', () => {
  // العطب الذي شكا منه المستخدم: dir="auto" يأخذ من أول حرف قويّ،
  // فتنقلب الجملة العربية كلها لأنها بدأت بمصطلح لاتيني.
  test('جملة عربية تبدأ بمصطلح إنجليزي تبقى يمينية', () => {
    assert.strictEqual(baseDir('React هو مكتبة لبناء الواجهات'), 'rtl');
    assert.strictEqual(baseDir('macOS هو نظام تشغيل من آبل'), 'rtl');
    assert.strictEqual(baseDir('OpenRouter يعطيك نماذج كثيرة بحساب واحد'), 'rtl');
  });

  test('جملة إنجليزية فيها كلمة عربية تبقى يسارية', () => {
    assert.strictEqual(baseDir('The app is called كُنّاش and it runs on macOS'), 'ltr');
  });

  test('العربية الخالصة والإنجليزية الخالصة', () => {
    assert.strictEqual(baseDir('اكتب لي ردًّا على هذا البريد'), 'rtl');
    assert.strictEqual(baseDir('Write me a reply to this email'), 'ltr');
  });

  // العدّ بالحروف كان يُسقط هذه: العربية تُسقط الحركات فكلماتها أقصر،
  // فجملة عربية قصيرة فيها مصطلح لاتيني طويل تُحسب يسارية وهي عربية.
  test('كلمة لاتينية طويلة لا تغلب كلمتين عربيتين قصيرتين', () => {
    assert.strictEqual(baseDir('حمّل DMG'), 'rtl');
    assert.strictEqual(baseDir('افتح Applications'), 'rtl');
    assert.strictEqual(baseDir('شغّل OpenRouter الآن'), 'rtl');
  });

  test('التساوي يرجّح اليمين — التطبيق عربي الأصل', () => {
    assert.strictEqual(baseDir('عربي English'), 'rtl');
    assert.strictEqual(baseDir('نص text'), 'rtl');
  });
});

describe('المحايد يرث ولا يُفرض عليه', () => {
  test('الأرقام والترقيم والرموز وحدها: لا اتجاه', () => {
    for (const s of ['123', '  ', '', '...', '2026-08-08', '$ 45.90', '— · —']) {
      assert.strictEqual(baseDir(s), null, JSON.stringify(s));
    }
  });

  test('null وundefined لا يرميان', () => {
    assert.strictEqual(baseDir(null), null);
    assert.strictEqual(baseDir(undefined), null);
  });
});

describe('حالات من الاستعمال الحقيقي', () => {
  test('مسار ملف عربي فيه امتداد لاتيني', () => {
    assert.strictEqual(baseDir('المخرجات/ملخص-الأسبوع.md'), 'rtl');
  });

  test('مسار لاتيني خالص', () => {
    assert.strictEqual(baseDir('.kunnash/skills/weekly/SKILL.md'), 'ltr');
  });

  test('جملة طويلة بمصطلحات تقنية متناثرة تبقى يمينية', () => {
    const s = 'حمّل ملف DMG ثم اسحب التطبيق إلى مجلد Applications، وسيعمل على macOS 12 فأحدث';
    assert.strictEqual(baseDir(s), 'rtl');
  });

  test('رسالة خطأ إنجليزية داخل واجهة عربية تبقى يسارية', () => {
    assert.strictEqual(baseDir('ECONNREFUSED: connection refused by the server'), 'ltr');
  });

  test('لغات يمينية أخرى تُعامل كالعربية', () => {
    assert.strictEqual(baseDir('שלום עולם'), 'rtl');            // عبري
    assert.strictEqual(baseDir('این یک آزمایش است'), 'rtl');     // فارسي
  });

  test('لغات يسارية غير لاتينية', () => {
    assert.strictEqual(baseDir('Привет мир'), 'ltr');           // كيريلي
    assert.strictEqual(baseDir('Γειά σου κόσμε'), 'ltr');        // يوناني
  });
});
