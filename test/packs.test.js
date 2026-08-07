// اختبارات م٥: حزم المهن ومساحات العمل المتعددة.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packs = require('../lib/packs');
const library = require('../lib/library');
const skills = require('../lib/agent/skills');
const { forgetRoot } = require('../lib/paths');

let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-packs-')); });
after(() => forgetRoot(root));

describe('قائمة الحزم', () => {
  test('الحزم موجودة ولكلٍّ وصف ومهارات', () => {
    const list = packs.list();
    assert.ok(list.length >= 3, `توقعنا ٣ حزم فأكثر، وجدنا ${list.length}`);
    for (const p of list) {
      assert.ok(p.label && p.description, `حزمة ${p.id} بلا وصف`);
      assert.ok(p.skills.length >= 3, `حزمة ${p.id} بأقل من ٣ مهارات`);
    }
  });

  test('كل ملف مهارة في الحزم صالح: ترويسة بـname وdescription', () => {
    for (const p of packs.list()) {
      for (const sid of p.skills) {
        const body = fs.readFileSync(path.join(packs.PACKS_DIR, p.id, 'skills', sid, 'SKILL.md'), 'utf8');
        assert.match(body, /^---\r?\n/, `${p.id}/${sid} بلا ترويسة`);
        assert.match(body, /\nname: .+/, `${p.id}/${sid} بلا name`);
        assert.match(body, /\ndescription: .+/, `${p.id}/${sid} بلا description`);
      }
    }
  });

  // الحزم بلا عبارات تفعيل تصير حِملًا: تظهر في الفهرس ولا تنطلق أبدًا
  test('كل مهارة تحمل عبارة تفعيل يفهمها المحفّز الحتمي', () => {
    for (const p of packs.list()) {
      for (const sid of p.skills) {
        const body = fs.readFileSync(path.join(packs.PACKS_DIR, p.id, 'skills', sid, 'SKILL.md'), 'utf8');
        const desc = (body.match(/\ndescription: (.+)/) || [])[1] || '';
        const name = (body.match(/\nname: (.+)/) || [])[1] || '';
        const triggers = skills.triggersOf({ id: sid, name, description: desc });
        assert.ok(triggers.length > 0, `${p.id}/${sid} بلا عبارات تفعيل`);
      }
    }
  });
});

describe('التثبيت', () => {
  test('التثبيت ينسخ المهارات فتظهر في المكتبة فورًا', () => {
    const before = library.listLibrary(root).skills.length;
    const res = packs.install(root, 'مكتب-عام');
    assert.ok(res.installed.length >= 3);
    assert.strictEqual(res.skipped.length, 0);

    const after = library.listLibrary(root).skills;
    assert.strictEqual(after.length, before + res.installed.length);
    assert.ok(after.some((s) => s.name === 'ملخص الأسبوع'));
    // مهارات حقيقية على القرص لا مراجع
    assert.ok(fs.existsSync(path.join(root, '.kunnash', 'skills', 'ملخص-الأسبوع', 'SKILL.md')));
  });

  test('إعادة التثبيت لا تطمس ما عدّله المستخدم', () => {
    const file = path.join(root, '.kunnash', 'skills', 'ملخص-الأسبوع', 'SKILL.md');
    const mine = '---\nname: ملخص الأسبوع\ndescription: نسختي أنا «ملخص الأسبوع»\n---\nخطواتي';
    fs.writeFileSync(file, mine);

    const res = packs.install(root, 'مكتب-عام');
    assert.ok(res.skipped.includes('ملخص-الأسبوع'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), mine, 'طُمس تعديل المستخدم');
  });

  test('حزمة ثانية تُضاف بجانب الأولى', () => {
    const before = library.listLibrary(root).skills.length;
    packs.install(root, 'أرقام-وجداول');
    assert.ok(library.listLibrary(root).skills.length > before);
  });

  test('حزمة غير موجودة ترفض برسالة مفهومة', () => {
    assert.throws(() => packs.install(root, 'لا-توجد'), /لا توجد حزمة/);
  });

  test('مهارة مثبّتة تنطلق بالمحفّز الحتمي', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-trig-'));
    packs.install(fresh, 'مكتب-عام');
    const hit = skills.matchSkill(fresh, 'اكتب لي ردًّا على هذا الإيميل من فضلك');
    assert.ok(hit, 'مهارة ردّ البريد لم تنطلق');
    assert.strictEqual(hit.skill.id, 'ردّ-بريد');
    forgetRoot(fresh);
  });
});

describe('مساحات عمل متعددة', () => {
  test('التبديل يحفظ الأخيرة أولًا، والمحذوفة تُعلَّم لا تُخفى', () => {
    delete require.cache[require.resolve('../lib/workspace')];
    const ws = require('../lib/workspace');
    ws.init(fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-ud-')));

    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-أ-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ب-'));
    ws.setWorkspace(a);
    ws.setWorkspace(b);

    let list = ws.listWorkspaces();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].path, b, 'الأحدث ليست أولًا');
    assert.strictEqual(list[0].current, true);
    assert.strictEqual(list[1].current, false);

    // العودة للأولى ترفعها للمقدمة بلا تكرار
    ws.setWorkspace(a);
    list = ws.listWorkspaces();
    assert.strictEqual(list.length, 2, 'تكرر المدخل بدل أن يُرفع');
    assert.strictEqual(list[0].path, a);

    // مجلد حُذف من القرص: يبقى في القائمة معلَّمًا
    fs.rmSync(b, { recursive: true });
    assert.strictEqual(ws.listWorkspaces().find((w) => w.path === b).missing, true);

    assert.strictEqual(ws.forgetWorkspace(b), true);
    assert.ok(!ws.listWorkspaces().some((w) => w.path === b));
  });

  test('لكل مساحة مهاراتها وأذوناتها — لا تتسرب بينها', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-عزل-أ-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-عزل-ب-'));
    packs.install(a, 'كتابة-ومحتوى');
    assert.ok(library.listLibrary(a).skills.length >= 3);
    assert.strictEqual(library.listLibrary(b).skills.length, 0, 'تسربت المهارات لمساحة أخرى');
    forgetRoot(a); forgetRoot(b);
  });
});
