// اختبارات الأدوات والنص المحفوظ — ما لم تغطه اختبارات الحلقة.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TOOL_MAP, globToRegex, assertPublicUrl } = require('../lib/agent/tools');
const transcript = require('../lib/agent/transcript');
const { validateArgs, parseArgs } = require('../lib/agent/registry');
const { forgetRoot } = require('../lib/paths');

let root, ctx;
const t = (name) => TOOL_MAP.get(name);

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-tools-'));
  ctx = { root };
  fs.mkdirSync(path.join(root, 'تقارير'));
  fs.writeFileSync(path.join(root, 'تقارير', 'يوليو.md'), '# تقرير يوليو\nالمبيعات: قيد التنفيذ\nالمشتريات: قيد التنفيذ');
  fs.writeFileSync(path.join(root, 'ملاحظة.txt'), 'المورد الرئيسي: النور');
});
after(() => forgetRoot(root));

describe('الكتابة والتحرير والحذف', () => {
  test('write_file ينشئ بمجلدات ناقصة ويميز الإنشاء عن الطمس', () => {
    const r1 = JSON.parse(t('write_file').exec({ path: 'مخرجات/جديد/أ.md', content: 'نص' }, ctx));
    assert.strictEqual(r1.state, 'created');
    const r2 = JSON.parse(t('write_file').exec({ path: 'مخرجات/جديد/أ.md', content: 'نص ثانٍ' }, ctx));
    assert.strictEqual(r2.state, 'overwritten');
  });

  test('edit_file: الغامض يرفض بعدد المواضع، وreplace_all يعالجها', () => {
    assert.throws(
      () => t('edit_file').exec({ path: 'تقارير/يوليو.md', old_text: 'قيد التنفيذ', new_text: 'منجز' }, ctx),
      /يطابق 2 مواضع/,
    );
    const r = JSON.parse(t('edit_file').exec({ path: 'تقارير/يوليو.md', old_text: 'قيد التنفيذ', new_text: 'منجز', replace_all: true }, ctx));
    assert.strictEqual(r.replacements, 2);
    assert.match(fs.readFileSync(path.join(root, 'تقارير', 'يوليو.md'), 'utf8'), /المبيعات: منجز/);
  });

  test('edit_file على نص غائب يوجه لقراءة الملف', () => {
    assert.throws(
      () => t('edit_file').exec({ path: 'ملاحظة.txt', old_text: 'غير موجود', new_text: 'x' }, ctx),
      /اقرأه وانسخ النص حرفيًا/,
    );
  });

  test('delete_file نقل إلى المهملات لا حذف — والمحتوى سليم فيها', () => {
    fs.writeFileSync(path.join(root, 'مسودة.md'), 'محتوى مهم');
    const r = JSON.parse(t('delete_file').exec({ path: 'مسودة.md' }, ctx));
    assert.ok(!fs.existsSync(path.join(root, 'مسودة.md')));
    assert.match(r.moved_to, /^\.kunnash\/trash\//);
    assert.strictEqual(fs.readFileSync(path.join(root, r.moved_to), 'utf8'), 'محتوى مهم');
  });

  test('لا unlink في الأدوات إطلاقًا (فحص نصي ثابت)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'agent', 'tools.js'), 'utf8');
    assert.ok(!/fs\.(unlinkSync|rmSync|rmdirSync)\b/.test(src), 'وُجد حذف حقيقي في الأدوات');
  });
});

describe('save_skill — بناء المهارات بالمحادثة', () => {
  // المهارات في .kunnash وهو ممنوع على الكتابة الحرة عمدًا: باب مسمّى واحد
  // يفتح ما يجب وحده، فيبقى المخزن (الجلسات والنصوص والمهملات) مغلقًا.
  test('write_file لا يستطيع الكتابة في مخزن كُنّاش', () => {
    assert.throws(
      () => t('write_file').exec({ path: '.kunnash/skills/س/SKILL.md', content: 'x' }, ctx),
      /مخزن كُنّاش/,
    );
  });

  test('save_skill ينشئ مهارة تظهر في المكتبة فورًا', () => {
    const before = require('../lib/library').listLibrary(root).skills.length;
    const out = JSON.parse(t('save_skill').exec({
      kind: 'skill', id: 'تقرير-الأسبوع',
      content: '---\nname: تقرير الأسبوع\ndescription: متى تُستخدم\n---\n# الخطوات',
    }, ctx));
    assert.strictEqual(out.saved, 'تقرير-الأسبوع');
    const skills = require('../lib/library').listLibrary(root).skills;
    assert.strictEqual(skills.length, before + 1);
    assert.ok(skills.some((s) => s.name === 'تقرير الأسبوع'));
  });

  test('عميل كذلك، ومحتوى بلا ترويسة مرفوض بسبب مفهوم', () => {
    t('save_skill').exec({ kind: 'agent', id: 'مراجع', content: '---\nname: مراجع\n---\nنص' }, ctx);
    assert.ok(require('../lib/library').listLibrary(root).agents.some((a) => a.id === 'مراجع'));
    assert.throws(
      () => t('save_skill').exec({ kind: 'skill', id: 'س', content: 'بلا ترويسة' }, ctx),
      /ترويسة/,
    );
  });

  test('يطلب إذنًا — ليس من أدوات القراءة الحرة', () => {
    assert.strictEqual(t('save_skill').permission, 'ask');
  });
});

describe('البحث والعثور', () => {
  test('list_files بنمط glob يرتب بالأحدث', () => {
    const out = t('list_files').exec({ pattern: '**/*.md' }, ctx);
    assert.match(out, /تقارير\/يوليو\.md/);
    assert.match(out, /مخرجات\/جديد\/أ\.md/);
    assert.ok(!out.includes('ملاحظة.txt'));
  });

  test('search_files يرجع ملف:سطر:مقتطف', () => {
    const out = t('search_files').exec({ query: 'المورد الرئيسي' }, ctx);
    assert.match(out, /^ملاحظة\.txt:1:المورد الرئيسي: النور/m);
  });

  test('glob: * لا يعبر المجلدات و** يعبرها', () => {
    assert.ok(globToRegex('*.md').test('a.md'));
    assert.ok(!globToRegex('*.md').test('dir/a.md'));
    assert.ok(globToRegex('**/*.md').test('dir/deep/a.md'));
    assert.ok(globToRegex('تقارير/*.md').test('تقارير/يوليو.md'));
  });

  test('رابط رمزي هارب لا يظهر في النتائج', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-out-'));
    fs.writeFileSync(path.join(outside, 'سري.md'), 'خارجي');
    fs.symlinkSync(path.join(outside, 'سري.md'), path.join(root, 'منفذ.md'));
    const out = t('list_files').exec({ pattern: '**/*.md' }, ctx);
    assert.ok(!out.includes('منفذ.md'), 'الرابط الهارب ظهر في القائمة');
  });
});

describe('حارس fetch_url', () => {
  test('العناوين الداخلية والبروتوكولات الغريبة مرفوضة', () => {
    for (const bad of [
      'http://localhost:11434/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x',
      'http://192.168.1.1/x', 'http://172.20.3.4/x', 'http://169.254.1.1/x',
      'http://server.local/x', 'file:///etc/passwd', 'ftp://x.com/f',
    ]) {
      assert.throws(() => assertPublicUrl(bad), Error, bad);
    }
  });
  test('العناوين العامة تمر', () => {
    assert.ok(assertPublicUrl('https://example.org/صفحة'));
    assert.ok(assertPublicUrl('http://172.15.0.1/ok'));   // خارج نطاق 172.16-31 الخاص
  });
});

describe('التحقق والقسر', () => {
  test('المرادفات: file_path تصير path', () => {
    const spec = TOOL_MAP.get('read_file');
    const v = validateArgs(spec, { file_path: 'ملاحظة.txt' });
    assert.ok(v.ok);
    assert.strictEqual(v.value.path, 'ملاحظة.txt');
  });
  test('رقم كنص يُقسر، وcontent كمصفوفة تُدمج', () => {
    const rf = validateArgs(TOOL_MAP.get('read_file'), { path: 'x', offset: '5' });
    assert.strictEqual(rf.value.offset, 5);
    const wf = validateArgs(TOOL_MAP.get('write_file'), { path: 'x', content: ['سطر', 'سطران'] });
    assert.strictEqual(wf.value.content, 'سطر\nسطران');
  });
  test('parseArgs يتحمل نصًا حول الكائن', () => {
    const r = parseArgs('سأستدعي الأداة الآن: {"path":"a.md"} وانتظر النتيجة');
    assert.ok(r.ok);
    assert.strictEqual(r.value.path, 'a.md');
  });
});

describe('تقليم النص المحفوظ', () => {
  const mkExchange = (n, big) => ([
    { role: 'assistant', content: '', tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${n}`, content: big ? 'س\n'.repeat(3000) : 'صغير' },
  ]);

  test('الإخلاء: نتائج الأدوات القديمة تصير سطرًا والبنية سليمة', () => {
    const messages = [
      { role: 'user', content: 'ابدأ' },
      ...mkExchange(1, true), ...mkExchange(2, true), ...mkExchange(3, true),
      { role: 'assistant', content: 'انتهيت' },
    ];
    const pruned = transcript.prune(messages, { keepToolBlocks: 2 });
    assert.ok(transcript.checkInvariant(pruned), 'الثابت انكسر بعد الإخلاء');
    assert.match(pruned[2].content, /أُزيلت لتوفير السياق/);       // الأقدم أُخلي
    assert.match(pruned[4].content, /^س\n/, 'كتلة ضمن آخر اثنتين أُخليت خطأً');
  });

  test('النافذة: لا تُسقَط tool دون مساعدها مهما ضاق الحد', () => {
    const messages = [{ role: 'user', content: 'الطلب الأصلي' }];
    for (let i = 0; i < 30; i++) messages.push(...mkExchange(i, true));
    for (const maxTokens of [500, 2000, 8000, 20000]) {
      const pruned = transcript.prune(messages, { maxTokens });
      assert.ok(transcript.checkInvariant(pruned), `الثابت انكسر عند حد ${maxTokens}`);
      assert.strictEqual(pruned[0].content, 'الطلب الأصلي', 'الرأس المثبّت ضاع');
    }
  });

  test('checkInvariant يكشف الكسر فعلًا (ليس فحصًا شكليًا)', () => {
    assert.ok(!transcript.checkInvariant([
      { role: 'user', content: 'س' },
      { role: 'tool', tool_call_id: 'يتيم', content: 'نتيجة بلا مساعد' },
    ]));
  });
});

describe('move_files — النقل دفعةً واحدة', () => {
  test('ينقل ويعيد التسمية ويُنشئ المجلدات الناقصة', () => {
    fs.writeFileSync(path.join(root, 'أ.md'), 'محتوى أ');
    fs.writeFileSync(path.join(root, 'ب.md'), 'محتوى ب');
    const out = JSON.parse(t('move_files').exec({ moves: [
      { from: 'أ.md', to: 'أرشيف/2026/أ.md' },
      { from: 'ب.md', to: 'أرشيف/ب-جديد.md' },
    ] }, ctx));
    assert.strictEqual(out.moved, 2);
    assert.strictEqual(fs.readFileSync(path.join(root, 'أرشيف', '2026', 'أ.md'), 'utf8'), 'محتوى أ');
    assert.strictEqual(fs.readFileSync(path.join(root, 'أرشيف', 'ب-جديد.md'), 'utf8'), 'محتوى ب');
  });

  // ملف ثنائي هو سبب وجود الأداة: write_file يكتب نصًّا فيتلفه
  test('الملف الثنائي ينتقل ببايتاته سليمة', () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xfe, 0x7f]);
    fs.writeFileSync(path.join(root, 'جدول.xlsx'), bytes);
    t('move_files').exec({ moves: [{ from: 'جدول.xlsx', to: 'أرقام/جدول.xlsx' }] }, ctx);
    assert.deepStrictEqual(fs.readFileSync(path.join(root, 'أرقام', 'جدول.xlsx')), bytes);
  });

  // خطة نصفها ناجح تترك المجلد في حالٍ لا يفهمها أحد
  test('نقلةٌ فاسدة تُبطل الخطة كلها قبل أن تُنفَّذ', () => {
    fs.writeFileSync(path.join(root, 'سليم.md'), 'x');
    assert.throws(() => t('move_files').exec({ moves: [
      { from: 'سليم.md', to: 'وجهة/سليم.md' },
      { from: 'لا-يوجد.md', to: 'وجهة/غائب.md' },
    ] }, ctx));
    assert.ok(fs.existsSync(path.join(root, 'سليم.md')), 'نُقل رغم فشل الخطة');
    assert.ok(!fs.existsSync(path.join(root, 'وجهة', 'سليم.md')));
  });

  test('لا يطمس هدفًا موجودًا', () => {
    fs.writeFileSync(path.join(root, 'مصدر.md'), 'جديد');
    fs.writeFileSync(path.join(root, 'قائم.md'), 'قديم');
    assert.throws(() => t('move_files').exec({ moves: [{ from: 'مصدر.md', to: 'قائم.md' }] }, ctx), /الهدف موجود/);
    assert.strictEqual(fs.readFileSync(path.join(root, 'قائم.md'), 'utf8'), 'قديم');
  });

  test('لا يخرج من مساحة العمل', () => {
    fs.writeFileSync(path.join(root, 'داخلي.md'), 'x');
    assert.throws(() => t('move_files').exec({ moves: [{ from: 'داخلي.md', to: '../هارب.md' }] }, ctx));
  });

  test('يطلب إذنًا — والإذن واحد للخطة كلها', () => {
    assert.strictEqual(t('move_files').permission, 'ask');
  });
});
