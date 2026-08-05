// اختبارات الذاكرة: التفضيلات، وأداة السؤال، وحقنها في رسالة النظام.

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const prefs = require('../lib/preferences');
const { TOOL_MAP } = require('../lib/agent/tools');
const { buildSystemMessages } = require('../lib/agent/index');
const { forgetRoot } = require('../lib/paths');

let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-prefs-')); });

describe('تخزين التفضيلات', () => {
  test('الحفظ والقراءة، وإعادة الحفظ تُحدّث لا تُكرّر', () => {
    prefs.remember(root, 'صيغة المخرجات', 'Word (docx)');
    prefs.remember(root, 'لغة التقارير', 'العربية الفصحى');
    prefs.remember(root, 'صيغة المخرجات', 'صفحة HTML');

    const items = prefs.load(root);
    assert.strictEqual(items.length, 2, 'تكرر المفتاح بدل أن يُحدَّث');
    assert.strictEqual(items.find((i) => i.key === 'صيغة المخرجات').value, 'صفحة HTML');
  });

  test('النسيان يزيل، وما ليس موجودًا يرجع false', () => {
    assert.strictEqual(prefs.forget(root, 'لغة التقارير'), true);
    assert.strictEqual(prefs.forget(root, 'لا يوجد'), false);
    assert.strictEqual(prefs.load(root).length, 1);
  });

  test('المفتاح أو القيمة الفارغة مرفوضة', () => {
    assert.throws(() => prefs.remember(root, '', 'قيمة'), /مفتاحًا وقيمة/);
    assert.throws(() => prefs.remember(root, 'مفتاح', '   '), /مفتاحًا وقيمة/);
  });

  test('سقف عدد البنود يمنع التضخم', () => {
    for (let i = 0; i < 60; i++) prefs.remember(root, 'مفتاح' + i, 'قيمة');
    assert.ok(prefs.load(root).length <= 40);
  });
});

describe('الحقن في رسالة النظام', () => {
  test('التفضيلات المحفوظة تصل النموذج مع أمر ألا يسأل عنها', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-sys-'));
    prefs.remember(fresh, 'صيغة المخرجات', 'Word (docx)');
    const [sys] = buildSystemMessages(fresh, { name: 'نوّاف' });
    assert.match(sys.content, /صيغة المخرجات: Word \(docx\)/);
    assert.match(sys.content, /لا تسأل عنها ثانية/);
    assert.match(sys.content, /نوّاف/);
    forgetRoot(fresh);
  });

  test('بلا تفضيلات لا تُحقن كتلة فارغة (استقرار البادئة للتخزين المؤقت)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-sys2-'));
    const [sys] = buildSystemMessages(empty, {});
    assert.ok(!sys.content.includes('تفضيلات صاحب مساحة العمل'));
    // نفس المدخلات تعطي نفس البايتات — شرط تطابق البادئة
    assert.strictEqual(sys.content, buildSystemMessages(empty, {})[0].content);
    forgetRoot(empty);
  });
});

describe('أداة ask_user', () => {
  const ask = TOOL_MAP.get('ask_user');

  test('تمرّر السؤال والخيارات، وترجع الاختيار للنموذج', async () => {
    let seen = null;
    const out = await ask.exec(
      { question: 'بأي صيغة تريد الملف؟', options: ['Word (docx)', 'صفحة HTML', 'ماركداون'] },
      { root, askUser: async (req) => { seen = req; return { answer: 'صفحة HTML', remember: false }; } },
    );
    assert.strictEqual(seen.question, 'بأي صيغة تريد الملف؟');
    assert.strictEqual(seen.options.length, 3);
    assert.match(out, /اختار المستخدم: صفحة HTML/);
    assert.ok(!out.includes('حُفظ'));
  });

  test('«احفظ اختياري» يخزّن التفضيل فعلًا ويخبر النموذج', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ask-'));
    const out = await ask.exec(
      { question: 'الصيغة؟', options: ['docx', 'html'], remember_key: 'صيغة المخرجات' },
      { root: fresh, askUser: async () => ({ answer: 'docx', remember: true }) },
    );
    assert.match(out, /حُفظ اختياره/);
    assert.strictEqual(prefs.load(fresh)[0].value, 'docx');
  });

  test('بلا remember_key لا يُحفظ شيء ولو طلب النموذج', async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ask2-'));
    await ask.exec(
      { question: 'س؟', options: ['أ', 'ب'] },
      { root: fresh, askUser: async () => ({ answer: 'أ', remember: true }) },
    );
    assert.strictEqual(prefs.load(fresh).length, 0, 'حُفظ تفضيل بلا مفتاح');
  });

  test('تجاهل المستخدم للسؤال يوجّه النموذج لا يعطّله', async () => {
    const out = await ask.exec(
      { question: 'س؟', options: ['أ', 'ب'] },
      { root, askUser: async () => ({ answer: null, remember: false }) },
    );
    assert.match(out, /اختر أنسب خيار واذكر ما افترضت/);
  });

  test('خيار واحد مرفوض، وسياق بلا واجهة يوجّه لا ينهار', async () => {
    await assert.rejects(
      () => ask.exec({ question: 'س؟', options: ['واحد'] }, { root, askUser: async () => ({}) }),
      /خيارين على الأقل/,
    );
    await assert.rejects(
      () => ask.exec({ question: 'س؟', options: ['أ', 'ب'] }, { root }),
      /اختر أنسب خيار/,
    );
  });

  test('السؤال بلا إذن — ليس فعلًا بل استفهام', () => {
    assert.strictEqual(ask.permission, 'none');
    assert.strictEqual(TOOL_MAP.get('remember').permission, 'ask');
  });
});
