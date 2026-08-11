// اختبارات حارس المسار — تشغيل: npm test
//
// ملاحظة مقصودة: مجلدات الاختبار تُنشأ تحت os.tmpdir()، وهو على الماك خلف
// رابط رمزي (‎/var ← /private/var‎). فكل اختبار هنا يجري على جذر غير محلول،
// وهي الحالة التي كانت تكسر الحراس السابقة.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveInWorkspace, writeFileGuarded, forgetRoot, APP_DIR } = require('../lib/paths');

let root;        // مساحة عمل الاختبار (مسار غير محلول)
let outside;     // مجلد خارجها

before(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-paths-'));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'تقارير'), { recursive: true });
  fs.mkdirSync(path.join(root, '.kunnash'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Keynote.app', 'Contents'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  fs.writeFileSync(path.join(root, 'تقارير', 'تقرير.md'), 'محتوى');
  fs.writeFileSync(path.join(outside, 'سرّي.txt'), 'لا يجوز الوصول');

  // رابط رمزي داخل المجلد يشير خارجه — الاختبار الجوهري
  fs.symlinkSync(path.join(outside, 'سرّي.txt'), path.join(root, 'منفذ.txt'));
  fs.symlinkSync(outside, path.join(root, 'مجلد-منفذ'));
  // ورابط رمزي داخلي مشروع
  fs.symlinkSync(path.join(root, 'تقارير'), path.join(root, 'اختصار'));
});

after(() => { forgetRoot(); });

const rejects = (input, code, opts) => {
  assert.throws(() => resolveInWorkspace(root, input, opts), (err) => {
    assert.strictEqual(err.code, code, `توقعنا ${code} فجاء ${err.code} — ${err.message}`);
    return true;
  });
};

describe('الاحتواء', () => {
  test('مسار نسبي عادي يمرّ', () => {
    const { rel } = resolveInWorkspace(root, 'تقارير/تقرير.md');
    assert.strictEqual(rel, 'تقارير/تقرير.md');
  });

  test('الجذر نفسه مقبول ويعطي rel فارغًا', () => {
    assert.strictEqual(resolveInWorkspace(root, '.').rel, '');
  });

  test('اجتياز ‎../‎ مرفوض', () => {
    rejects('../سرّي.txt', 'OUTSIDE_WORKSPACE');
    rejects('تقارير/../../outside/سرّي.txt', 'OUTSIDE_WORKSPACE');
    rejects('../../../../../../etc/passwd', 'OUTSIDE_WORKSPACE');
  });

  test('مسار مطلق خارج المجلد مرفوض', () => {
    rejects('/etc/passwd', 'OUTSIDE_WORKSPACE');
    rejects(path.join(outside, 'سرّي.txt'), 'OUTSIDE_WORKSPACE');
  });

  test('مسار مطلق داخل المجلد مقبول', () => {
    const { rel } = resolveInWorkspace(root, path.join(root, 'تقارير', 'تقرير.md'));
    assert.strictEqual(rel, 'تقارير/تقرير.md');
  });

  // ‎startsWith(root + sep)‎ يمسك هذه، لكن ‎startsWith(root)‎ وحدها تسقط فيها
  test('مجلد شقيق يبدأ باسم الجذر لا يخترق', () => {
    const sibling = root + '-٢';
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(path.join(sibling, 'ملف.txt'), 'خارج');
    rejects(path.join(sibling, 'ملف.txt'), 'OUTSIDE_WORKSPACE');
  });
});

describe('الروابط الرمزية', () => {
  test('رابط داخل المجلد يشير لملف خارجه مرفوض', () => {
    rejects('منفذ.txt', 'OUTSIDE_WORKSPACE');
  });

  test('رابط لمجلد خارجي مرفوض حتى مع ذيل تحته', () => {
    rejects('مجلد-منفذ', 'OUTSIDE_WORKSPACE');
    rejects('مجلد-منفذ/سرّي.txt', 'OUTSIDE_WORKSPACE');
  });

  test('رابط داخلي مشروع يُقبل ويُحلّ لهدفه', () => {
    const { rel } = resolveInWorkspace(root, 'اختصار/تقرير.md');
    assert.strictEqual(rel, 'تقارير/تقرير.md');
  });

  test('الجذر خلف رابط رمزي: مسار داخله يُقبل ولا يُرفض كذبًا', () => {
    // ‎/tmp ← /private/tmp‎ — الحالة التي تكسر الحراس بلا realpath
    const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-link-'));
    const real = path.join(linkedRoot, 'حقيقي');
    const via = path.join(linkedRoot, 'عبر-رابط');
    fs.mkdirSync(real);
    fs.symlinkSync(real, via);
    fs.writeFileSync(path.join(real, 'ملف.txt'), 'محتوى');

    const { rel } = resolveInWorkspace(via, 'ملف.txt');
    assert.strictEqual(rel, 'ملف.txt');
    forgetRoot(via);
  });
});

describe('الكتابة', () => {
  test('ملف غير موجود يُقبل للكتابة (لا يمكن realpath لما لم يُنشأ)', () => {
    const { abs, rel } = resolveInWorkspace(root, 'تقارير/جديد/عميق/ملف.md', { forWrite: true });
    assert.strictEqual(rel, 'تقارير/جديد/عميق/ملف.md');
    assert.ok(path.isAbsolute(abs));
  });

  test('اجتياز في مسار غير موجود يُرفض أيضًا', () => {
    rejects('جديد/../../خارج/ملف.md', 'OUTSIDE_WORKSPACE', { forWrite: true });
  });

  test('قائمة المنع: مخزن كُنّاش وgit وclaude وحزم التطبيقات', () => {
    rejects('.kunnash/sessions.json', 'DENIED', { forWrite: true });
    rejects('.git/config', 'DENIED', { forWrite: true });
    rejects('.claude/skills/x/SKILL.md', 'DENIED', { forWrite: true });
    rejects('Keynote.app/Contents/ملف', 'DENIED', { forWrite: true });
  });

  test('الممنوع للكتابة مقروء', () => {
    assert.strictEqual(resolveInWorkspace(root, '.kunnash').rel, '.kunnash');
    assert.strictEqual(resolveInWorkspace(root, '.claude/skills').rel, '.claude/skills');
  });

  test('شيفرة التطبيق نفسها ممنوعة حين تكون مساحة العمل هي مجلد المشروع', () => {
    assert.throws(
      () => resolveInWorkspace(APP_DIR, 'main.js', { forWrite: true }),
      (err) => err.code === 'DENIED',
    );
    // وقراءتها مسموحة
    assert.strictEqual(resolveInWorkspace(APP_DIR, 'main.js').rel, 'main.js');
    forgetRoot(APP_DIR);
  });
});

describe('المدخلات الفاسدة', () => {
  test('غير النصوص والفارغ والبايت الصفري', () => {
    for (const bad of [null, undefined, 42, {}, []]) rejects(bad, 'BAD_INPUT');
    rejects('', 'BAD_INPUT');
    rejects('   ', 'BAD_INPUT');
    rejects('ملف\0.txt', 'BAD_INPUT');
  });

  test('الروابط ليست مسارات', () => {
    rejects('https://example.org/x', 'BAD_INPUT');
    rejects('file:///etc/passwd', 'BAD_INPUT');
    rejects('data:text/html,<b>x</b>', 'BAD_INPUT');
    rejects('javascript:alert(1)', 'BAD_INPUT');
  });

  test('mustExist يميّز الغائب', () => {
    rejects('لا-يوجد.md', 'NOT_FOUND', { mustExist: true });
    assert.ok(resolveInWorkspace(root, 'تقارير/تقرير.md', { mustExist: true }).abs);
  });
});

describe('الكتابة المقسّاة', () => {
  test('تكتب وتنشئ المجلدات الناقصة', () => {
    const { abs } = resolveInWorkspace(root, 'مخرجات/تقرير.md', { forWrite: true });
    writeFileGuarded(abs, 'مرحبًا');
    assert.strictEqual(fs.readFileSync(abs, 'utf8'), 'مرحبًا');
  });

  test('ترفض الكتابة عبر رابط رمزي حتى لو صُنع بعد الفحص', () => {
    const target = path.join(root, 'هدف-مسروق.txt');
    const { abs } = resolveInWorkspace(root, 'هدف-مسروق.txt', { forWrite: true });
    // محاكاة السباق: يُصنع الرابط بين الفحص والفتح
    fs.symlinkSync(path.join(outside, 'سرّي.txt'), target);
    assert.throws(() => writeFileGuarded(abs, 'اختراق'), (err) => err.code === 'DENIED');
    assert.strictEqual(fs.readFileSync(path.join(outside, 'سرّي.txt'), 'utf8'), 'لا يجوز الوصول');
  });
});

// ————— فاصل المسار موحّد —————
// `rel` ليس مسار نظامٍ يُفتح به ملف، بل **قيمة تُعرض وتُطابَق**: تظهر
// للمستخدم، وتُقارن بأنماط glob، وتُحفظ في قواعد الأذونات. فلو خرجت
// بـ«\» على ويندوز لانكسر كل ذلك — واختبارٌ يمرّ على الماك وحده لا يكشفه.
describe('فاصل المسار في المُخرَج', () => {
  test('rel يخرج بـ«/» دائمًا مهما تعمّق', () => {
    const deep = path.join(root, 'أ', 'ب', 'ج');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'د.md'), 'x');
    const { rel } = resolveInWorkspace(root, 'أ/ب/ج/د.md');
    assert.strictEqual(rel, 'أ/ب/ج/د.md');
    assert.ok(!rel.includes('\\'), `تسرّب فاصل ويندوز: ${rel}`);
  });

});
