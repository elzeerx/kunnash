// اختبارات م٤: بوابة الإذن بقواعد ذات نطاق، والمحفّز الحتمي للمهارات.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const perms = require('../lib/agent/permissions');
const skills = require('../lib/agent/skills');
const { runLoop } = require('../lib/agent/loop');
const { runAgent } = require('../lib/agent/index');
const { forgetRoot } = require('../lib/paths');

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-perm-'));
  fs.mkdirSync(path.join(root, 'تقارير'), { recursive: true });
  fs.writeFileSync(path.join(root, 'تقارير', 'أ.md'), 'محتوى');
});
after(() => forgetRoot(root));

describe('اشتقاق النطاق — لا أوسع من الطلب الذي ولّده', () => {
  test('ملفات: النطاق مجلد الهدف لا كل مساحة العمل', () => {
    const d = perms.deriveScope('write_file', { path: 'مخرجات/تقارير/يوليو.md' }, root);
    assert.strictEqual(d.scope, 'مخرجات/تقارير/**');
    assert.strictEqual(d.kind, 'file');
  });

  test('شبكة: الأصل فقط — لا مسار ولا نجمة', () => {
    const d = perms.deriveScope('fetch_url', { url: 'https://example.org/a/b?q=1' }, root);
    assert.strictEqual(d.scope, 'https://example.org');
    assert.strictEqual(d.kind, 'net');
  });

  test('عميل: معرّفه وحده', () => {
    assert.strictEqual(perms.deriveScope('run_agent', { agent_id: 'مراجع' }, root).scope, 'مراجع');
  });

  test('مسار خارج مساحة العمل لا يعطي نطاقًا (فلا يُحفظ إذن له)', () => {
    assert.strictEqual(perms.deriveScope('write_file', { path: '/etc/passwd' }, root), null);
  });
});

describe('التغطية والصلاحية', () => {
  beforeEach(() => {
    try { fs.rmSync(path.join(root, '.kunnash', 'permissions.json')); } catch { /* أول مرة */ }
  });

  test('قاعدة مجلد تغطي ما تحته ولا تغطي غيره', () => {
    perms.remember(root, 'write_file', { path: 'مخرجات/تقارير/أ.md' });
    assert.ok(perms.isAllowed(root, 'write_file', { path: 'مخرجات/تقارير/ب.md' }));
    assert.ok(perms.isAllowed(root, 'write_file', { path: 'مخرجات/تقارير/عميق/ج.md' }));
    assert.ok(!perms.isAllowed(root, 'write_file', { path: 'مخرجات/عروض/د.md' }),
      'القاعدة تسرّبت لمجلد شقيق');
    assert.ok(!perms.isAllowed(root, 'write_file', { path: 'خاص/هـ.md' }));
  });

  test('القاعدة تخص أداتها وحدها', () => {
    perms.remember(root, 'write_file', { path: 'مخرجات/أ.md' });
    assert.ok(!perms.isAllowed(root, 'delete_file', { path: 'مخرجات/أ.md' }),
      'إذن الكتابة سمح بالحذف');
  });

  test('قاعدة الشبكة تخص أصلها ولا تتعدى لغيره', () => {
    perms.remember(root, 'fetch_url', { url: 'https://example.org/x' });
    assert.ok(perms.isAllowed(root, 'fetch_url', { url: 'https://example.org/y/z' }));
    assert.ok(!perms.isAllowed(root, 'fetch_url', { url: 'https://evil.org/x' }));
    assert.ok(!perms.isAllowed(root, 'fetch_url', { url: 'http://example.org/x' }), 'اختلف البروتوكول');
  });

  test('قواعد الشبكة تنتهي بثلاثين يومًا، وقواعد الملفات لا تنتهي', () => {
    const net = perms.remember(root, 'fetch_url', { url: 'https://example.org' });
    const file = perms.remember(root, 'write_file', { path: 'مخرجات/أ.md' });
    assert.ok(net.expiresAt > Date.now());
    assert.ok(Math.abs(net.expiresAt - Date.now() - perms.NET_TTL_MS) < 5000);
    assert.strictEqual(file.expiresAt, undefined);
  });

  test('القاعدة المنتهية لا تُحمَّل ولا تسمح', () => {
    const f = path.join(root, '.kunnash', 'permissions.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      rules: [{ tool: 'fetch_url', scope: 'https://old.org', kind: 'net', expiresAt: Date.now() - 1000 }],
    }));
    assert.strictEqual(perms.load(root).length, 0);
    assert.ok(!perms.isAllowed(root, 'fetch_url', { url: 'https://old.org/x' }));
  });

  test('السحب يزيل القاعدة', () => {
    perms.remember(root, 'write_file', { path: 'مخرجات/أ.md' });
    assert.strictEqual(perms.revoke(root, 'write_file', 'مخرجات/**'), true);
    assert.ok(!perms.isAllowed(root, 'write_file', { path: 'مخرجات/ب.md' }));
    assert.strictEqual(perms.revoke(root, 'write_file', 'لا-يوجد/**'), false);
  });
});

describe('استثناء مجلد المخرجات', () => {
  test('الكتابة داخله لا تُسأل، وخارجه تُسأل، والحذف يُسأل دائمًا', () => {
    assert.ok(perms.isInOutputs('write_file', { path: 'المخرجات/تقرير.md' }, root));
    assert.ok(perms.isInOutputs('render_document', { out_path: 'المخرجات/تقرير.docx' }, root));
    assert.ok(!perms.isInOutputs('write_file', { path: 'خاص/سر.md' }, root));
    assert.ok(!perms.isInOutputs('delete_file', { path: 'المخرجات/تقرير.md' }, root),
      'الحذف تجاوز البوابة داخل المخرجات');
  });

  test('اسم يبدأ بالمخرجات لكنه مجلد آخر لا يُخدع', () => {
    assert.ok(!perms.isInOutputs('write_file', { path: 'المخرجات-القديمة/أ.md' }, root));
  });
});

describe('المحفّز الحتمي للمهارات', () => {
  let sroot;
  const addSkill = (id, name, desc) => {
    const dir = path.join(sroot, '.kunnash', 'skills', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nخطوات`);
  };

  before(() => {
    sroot = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-skills-'));
    addSkill('weekly', 'ملخص الأسبوع', 'تُستخدم عند طلب «سوّ لي ملخص الأسبوع» أو «تقرير الأسبوع».');
    addSkill('invoices', 'مراجعة الفواتير', 'تُستخدم عند طلب «راجع فواتير الموردين».');
  });
  after(() => forgetRoot(sroot));

  test('عبارة تفعيل صريحة تُطابق مهارة واحدة', () => {
    const hit = skills.matchSkill(sroot, 'سوّ لي ملخص الأسبوع من فضلك');
    assert.ok(hit);
    assert.strictEqual(hit.skill.id, 'weekly');
  });

  test('التطبيع يتجاوز التشكيل واختلاف الألف والتاء المربوطة', () => {
    assert.ok(skills.matchSkill(sroot, 'ابي ملخص الاسبوع'), 'سقط عند «الاسبوع» بلا همزة');
    assert.ok(skills.matchSkill(sroot, 'راجع فواتير المورّدين اليوم'));
  });

  // المطابقة متتالية بفجوة محدودة: الحشو الطبيعي يمرّ والتباعد لا يمرّ
  test('الحشو الطبيعي بين كلمات العبارة يمرّ', () => {
    assert.ok(skills.matchSkill(sroot, 'سوّ لي من فضلك ملخص هذا الأسبوع'),
      'كلمة واحدة بين «ملخص» و«الأسبوع» أسقطت المطابقة');
    assert.ok(skills.matchSkill(sroot, 'من فضلك راجع فواتير كل الموردين اليوم'));
  });

  test('التباعد البعيد لا يمرّ — لا مطابقة بالصدفة', () => {
    assert.strictEqual(
      skills.matchSkill(sroot, 'أريد ملخص المشروع ثم بعد ذلك خطة الشهر ثم إجازة الأسبوع'),
      null,
      'طابقت كلمتين متباعدتين بالصدفة',
    );
  });

  test('الترتيب شرط — الكلمات معكوسة لا تطابق', () => {
    assert.strictEqual(skills.matchSkill(sroot, 'الأسبوع ملخص'), null);
  });

  test('matchesTrigger وحدها: الحدود بالضبط', () => {
    const t = ['اكتب', 'ردا'];
    assert.ok(skills.matchesTrigger(['اكتب', 'ردا'], t));                    // متلاصقتان
    assert.ok(skills.matchesTrigger(['اكتب', 'لي', 'ردا'], t));              // فجوة ١
    assert.ok(skills.matchesTrigger(['اكتب', 'لي', 'الآن', 'ردا'], t));      // فجوة ٢
    assert.ok(!skills.matchesTrigger(['اكتب', 'أ', 'ب', 'ج', 'ردا'], t));    // فجوة ٣
    assert.ok(!skills.matchesTrigger(['ردا', 'اكتب'], t));                   // معكوسة
  });

  test('بلا تطابق: لا حقن', () => {
    assert.strictEqual(skills.matchSkill(sroot, 'كم الساعة الآن؟'), null);
  });

  test('تطابقان: لا حقن — لا نرجّح بين مهارتين', () => {
    assert.strictEqual(
      skills.matchSkill(sroot, 'سوّ لي ملخص الأسبوع ثم راجع فواتير الموردين'),
      null,
    );
  });

  test('الكلمة الواحدة لا تكفي — تطابق بالصدفة', () => {
    const t = skills.triggersOf({ name: 'تقرير', id: 'r', description: 'وصف بلا عبارات' });
    assert.deepStrictEqual(t, []);
  });

  test('رسالة المهارة تحمل نصها كاملًا بأمر الالتزام', () => {
    const msg = skills.skillMessage(sroot, 'weekly');
    assert.strictEqual(msg.role, 'system');
    assert.match(msg.content, /اتبع خطواتها حرفيًا/);
    assert.match(msg.content, /ملخص الأسبوع/);
  });
});

// ---------- التكامل: البوابة داخل الحلقة ----------
describe('البوابة في الحلقة الحقيقية', () => {
  let server, base, wroot;
  let script = [];

  const sse = (res, ev) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const e of ev) res.write(`data: ${JSON.stringify(e)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  };
  const callDelta = (id, name, args) => ({
    choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }],
  });
  const textDelta = (t) => ({ choices: [{ delta: { content: t } }] });
  const finish = () => ({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });

  before(async () => {
    wroot = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-gate-'));
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => (script.shift() || ((_q, r) => r.writeHead(500).end('x')))(JSON.parse(b), res));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.close(); forgetRoot(wroot); });

  const run = (onPermission) => runLoop({
    cfg: { label: 'م', model: 'm', apiKey: 'k', baseUrl: `${base}/v1`, dataPolicy: 'allow' },
    systemMessages: [{ role: 'system', content: 'س' }],
    messages: [{ role: 'user', content: 'نفّذ' }],
    ctx: { root: wroot },
    onPermission,
  });

  test('الكتابة في المخرجات تمرّ بلا سؤال', async () => {
    script = [
      (q, res) => sse(res, [callDelta('c1', 'write_file', { path: 'المخرجات/تقرير.md', content: 'نص' }), finish()]),
      (q, res) => sse(res, [textDelta('تم.')]),
    ];
    let asked = 0;
    await run(() => { asked++; return 'allow'; });
    assert.strictEqual(asked, 0, 'سأل عن الكتابة في مجلد المخرجات');
    assert.ok(fs.existsSync(path.join(wroot, 'المخرجات', 'تقرير.md')));
  });

  test('الكتابة خارجه تسأل، و«دائمًا» تحفظ قاعدة بنطاقها', async () => {
    script = [
      (q, res) => sse(res, [callDelta('c1', 'write_file', { path: 'خاص/أ.md', content: 'ن' }), finish()]),
      (q, res) => sse(res, [textDelta('تم.')]),
    ];
    let seenScope = null;
    await run((req) => { seenScope = req.alwaysScope; return 'always'; });
    // يُقاس المعنى لا الصياغة: هل يعرف المستخدم **ماذا** يسمح و**أين** قبل
    // أن يضغط؟ (كان الوصف «write_file في خاص/**» — اسم دالةٍ ورمزٌ لا يُفهمان)
    assert.match(seenScope, /خاص/, 'لم يُسمَّ المجلد الذي ستغطيه القاعدة');
    assert.match(seenScope, /كتابة|الكتابة/, 'لم يُذكر الفعل الذي يُسمح به');
    assert.ok(!/write_file|\*\*/.test(seenScope), 'الإفصاح بلغة المبرمجين لا بلغة صاحبه');

    const rules = perms.load(wroot);
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].scope, 'خاص/**');

    // الطلب التالي في نفس المجلد لا يسأل، وفي غيره يسأل
    script = [
      (q, res) => sse(res, [callDelta('c2', 'write_file', { path: 'خاص/ب.md', content: 'ن' }), finish()]),
      (q, res) => sse(res, [textDelta('تم.')]),
    ];
    let asked = 0;
    await run(() => { asked++; return 'allow'; });
    assert.strictEqual(asked, 0, 'القاعدة المحفوظة لم تُستشر');

    script = [
      (q, res) => sse(res, [callDelta('c3', 'write_file', { path: 'أخرى/ج.md', content: 'ن' }), finish()]),
      (q, res) => sse(res, [textDelta('تم.')]),
    ];
    asked = 0;
    await run(() => { asked++; return 'allow'; });
    assert.strictEqual(asked, 1, 'القاعدة تسرّبت لمجلد لم تُولد منه');
  });
});

describe('حقن المهارة في runAgent', () => {
  let server, base, aroot;
  before(async () => {
    aroot = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-inj-'));
    const dir = path.join(aroot, '.kunnash', 'skills', 'weekly');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'),
      '---\nname: ملخص الأسبوع\ndescription: تُستخدم عند «ملخص الأسبوع».\n---\n# ملخص\nثلاث نقاط فقط.');
    server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        lastReq = JSON.parse(b);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'تم' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.close(); forgetRoot(aroot); });
  let lastReq = null;

  const go = (userContent, forceSkillId) => runAgent({
    cfg: { label: 'م', model: 'm', apiKey: 'k', baseUrl: `${base}/v1`, dataPolicy: 'allow' },
    root: aroot, sessionId: 's' + Math.random(),
    userContent, forceSkillId,
    onPermission: () => 'allow',
  });

  test('المحفّز يحقن المهارة رسالةَ نظام ثانية ويُعلمها', async () => {
    const res = await go('سوّ لي ملخص الأسبوع');
    assert.strictEqual(res.injectedSkill, 'weekly');
    const sys = lastReq.messages.filter((m) => m.role === 'system');
    assert.strictEqual(sys.length, 2, 'المهارة لم تُحقن رسالةَ نظام');
    assert.match(sys[1].content, /ثلاث نقاط فقط/);
    // ولا تدخل النص المحفوظ — تعيش للتشغيل الواحد
    assert.ok(!lastReq.messages.some((m) => m.role === 'user' && /ثلاث نقاط فقط/.test(m.content)));
  });

  test('بلا تطابق لا حقن ولا رسالة نظام ثانية', async () => {
    const res = await go('كم الساعة؟');
    assert.strictEqual(res.injectedSkill, null);
    assert.strictEqual(lastReq.messages.filter((m) => m.role === 'system').length, 1);
  });

  test('التفعيل اليدوي يفرض الحقن ولو لم يطابق النص', async () => {
    const res = await go('أي شيء', 'weekly');
    assert.strictEqual(res.injectedSkill, 'weekly');
    assert.match(lastReq.messages.filter((m) => m.role === 'system')[1].content, /ثلاث نقاط/);
  });

  test('مهارة محذوفة لا تُسقط التشغيل', async () => {
    const res = await go('أي شيء', 'غير-موجودة');
    assert.strictEqual(res.injectedSkill, null);
    assert.strictEqual(res.text, 'تم');
  });
});

// ————— ما كشفه فحص التطبيق —————
describe('اشتقاق نطاق النقل ووضوح الإفصاح', () => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-scope-'));
  const scopeOf = (moves) => {
    const d = perms.deriveScope('move_files', { moves }, root);
    return d && d.scope;
  };

  // كان move_files بلا اشتقاق: «السماح دائمًا» عليه يمنح نقلًا غير محصور
  // لبقية التشغيل — يوافق المستخدم على خطةٍ في «تقارير/» فيصير كل شيء مباحًا
  test('النقل صار له نطاق بعد أن كان بلا نطاق', () => {
    assert.strictEqual(scopeOf([{ from: 'تقارير/أ.md', to: 'تقارير/ب.md' }]), 'تقارير/**');
  });

  // النقل يمسّ طرفين: نطاقه ما يسع المصدر والهدف معًا، لا أحدهما
  test('النطاق يسع طرفي كل نقلة', () => {
    assert.strictEqual(
      scopeOf([{ from: 'تقارير/٢٠٢٥/أ.md', to: 'تقارير/٢٠٢٦/ب.md' }]),
      'تقارير/**', 'الأب المشترك يسع الطرفين',
    );
    assert.strictEqual(
      scopeOf([{ from: 'تقارير/أ.md', to: 'مالية/ب.md' }]),
      '**', 'مجلدان لا جامع لهما إلا الجذر',
    );
  });

  test('كل نقلات الخطة تدخل الحساب لا أولاها', () => {
    const s = scopeOf([
      { from: 'تقارير/أ.md', to: 'تقارير/ب.md' },
      { from: 'تقارير/ج.md', to: 'مالية/د.md' },   // هذه وحدها توسّع النطاق
    ]);
    assert.strictEqual(s, '**', 'نقلةٌ خارجة توسّع النطاق فلا يُخفى اتساعه');
  });

  test('خطة ناقصة لا يُشتق لها نطاق فلا يُعرض «دائمًا»', () => {
    // المهم أن لا نطاق يُشتق — فلا تُحفظ قاعدة على خطةٍ لا تُفهم حدودها
    assert.ok(!perms.deriveScope('move_files', { moves: [] }, root));
    assert.ok(!perms.deriveScope('move_files', { moves: [{ from: 'أ.md' }] }, root));
    assert.ok(!perms.deriveScope('move_files', {}, root));
  });

  // «delete_file في **» تحت أخطر زرٍّ في التطبيق: اسمُ دالةٍ ورمزٌ لا يفهمهما
  // إلا مبرمج — و«**» تعني «كل مساحة عملك إلى الأبد»
  test('الإفصاح بلغة صاحبه: لا أسماء دوالّ ولا رموز', () => {
    for (const [tool, scope, kind] of [
      ['delete_file', '**', 'file'],
      ['write_file', 'تقارير/**', 'file'],
      ['move_files', '**', 'file'],
      ['fetch_url', 'https://example.com', 'net'],
    ]) {
      const d = perms.describe(tool, scope, kind);
      assert.ok(!/_/.test(d), `«${d}» فيه اسم دالة`);
      assert.ok(!/\*/.test(d), `«${d}» فيه رمز glob`);
    }
  });

  test('«**» تُقال صراحةً: كل مساحة عملك', () => {
    assert.match(perms.describe('delete_file', '**', 'file'), /كل مساحة عملك/);
    assert.match(perms.describe('write_file', 'تقارير/**', 'file'), /«تقارير»/);
  });
});
