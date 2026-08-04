// اختبارات المكتبة — تتحقق من سلوكها بعد تمريرها بحارس المسار،
// ومن قاعدة «نقرأ من ‎.claude/‎ ولا نكتب فيه».

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('../lib/library');
const { forgetRoot } = require('../lib/paths');

let root;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-lib-'));
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'قديمة'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude', 'skills', 'قديمة', 'SKILL.md'),
    '---\nname: مهارة قديمة\ndescription: من مجلد claude\n---\n',
  );
});

describe('الحفظ والقراءة', () => {
  test('حفظ مهارة ثم قراءتها', () => {
    lib.saveItem(root, 'skill', 'weekly-report', '---\nname: تقرير\ndescription: وصف\n---\nمحتوى');
    assert.match(lib.readItem(root, 'skill', 'weekly-report'), /محتوى/);
    assert.ok(fs.existsSync(path.join(root, '.kunnash', 'skills', 'weekly-report', 'SKILL.md')));
  });

  test('الكتابة تذهب إلى ‎.kunnash‎ لا ‎.claude‎', () => {
    lib.saveItem(root, 'agent', 'reviewer', '---\nname: مراجع\n---\n');
    assert.ok(fs.existsSync(path.join(root, '.kunnash', 'agents', 'reviewer.md')));
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'agents', 'reviewer.md')));
  });

  test('معرّف فيه اجتياز مرفوض قبل أن يصل للقرص', () => {
    for (const bad of ['../خارج', 'a/b', '.kunnash', '.git', 'a|b', '', '  فراغ  ']) {
      assert.throws(() => lib.saveItem(root, 'skill', bad, 'x'), /معرّف غير صالح/);
    }
  });

  // القاعدة أمنية لا إملائية: تطبيق عربي يجب أن يقبل أسماء عربية، وإلا ظهرت
  // المهارة في القائمة (لأن العرض يقرأ القرص) ورفض فتحُها — تعارضٌ يُرى عطلًا
  test('معرّف عربي مقبول ويُقرأ ويُحذف', () => {
    lib.saveItem(root, 'skill', 'تقرير-الأسبوع', '---\nname: تقرير الأسبوع\n---\nخطوات');
    assert.match(lib.readItem(root, 'skill', 'تقرير-الأسبوع'), /خطوات/);
    assert.ok(lib.listLibrary(root).skills.some((s) => s.id === 'تقرير-الأسبوع'));
    assert.strictEqual(lib.deleteItem(root, 'skill', 'تقرير-الأسبوع'), true);
  });

  test('كل ما تعرضه القائمة يمكن قراءته — لا عنصر معروض غير قابل للفتح', () => {
    for (const item of [...lib.listLibrary(root).skills, ...lib.listLibrary(root).agents]) {
      assert.doesNotThrow(() => lib.readItem(root, item.type, item.id), `تعذّر فتح ${item.id}`);
    }
  });
});

describe('القراءة الاحتياطية من ‎.claude‎', () => {
  test('تظهر مهارات المجلدين معًا', () => {
    const ids = lib.listLibrary(root).skills.map((s) => s.id).sort();
    assert.deepStrictEqual(ids, ['weekly-report', 'قديمة'].sort());
  });

  test('ما في ‎.kunnash‎ يحجب ما يحمله ‎.claude‎ بنفس المعرّف', () => {
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'weekly-report'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.claude', 'skills', 'weekly-report', 'SKILL.md'),
      '---\nname: النسخة القديمة\n---\n',
    );
    const found = lib.listLibrary(root).skills.find((s) => s.id === 'weekly-report');
    assert.strictEqual(found.name, 'تقرير', 'المتوقع أن تفوز نسخة .kunnash');
  });

  test('حذف عنصر يسكن ‎.claude‎ مرفوض برسالة صريحة', () => {
    assert.throws(() => lib.deleteItem(root, 'skill', 'قديمة'), /لا يحذفه كُنّاش/);
    assert.ok(fs.existsSync(path.join(root, '.claude', 'skills', 'قديمة', 'SKILL.md')));
  });
});

describe('الحذف', () => {
  test('حذف مهارة يزيل مجلدها', () => {
    assert.strictEqual(lib.deleteItem(root, 'skill', 'weekly-report'), true);
    assert.ok(!fs.existsSync(path.join(root, '.kunnash', 'skills', 'weekly-report')));
    forgetRoot(root);
  });

  test('حذف غير الموجود يرجع false لا يرمي', () => {
    assert.strictEqual(lib.deleteItem(root, 'agent', 'لا-يوجد-اصلا'), false);
  });
});
