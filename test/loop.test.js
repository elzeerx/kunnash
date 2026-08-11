// اختبارات الحلقة — خادم محاكاة «مبرمَج بسيناريو»: كل اختبار يملي على
// المزوّد ماذا يرد في كل جولة، ونتحقق من سلوك الحلقة تجاهه.
// هذه ترجمة جدول متانة م٣ إلى اختبارات ثابتة.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runLoop } = require('../lib/agent/loop');
const { runAgent } = require('../lib/agent/index');
const transcript = require('../lib/agent/transcript');
const { forgetRoot } = require('../lib/paths');

let server, base, root;
let script = [];        // سيناريو الجولات: كل عنصر دالة (requestBody) → أحداث SSE
let requests = [];      // ما وصل للخادم

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}
// اختصارات بناء الأحداث
const textDelta = (t) => ({ choices: [{ delta: { content: t } }] });
const callDelta = (index, id, name, args) => ({
  choices: [{ delta: { tool_calls: [{ index, ...(id ? { id } : {}), function: { ...(name ? { name } : {}), ...(args !== undefined ? { arguments: args } : {}) } }] } }],
});
const finish = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] });

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-loop-'));
  fs.writeFileSync(path.join(root, 'ملف.txt'), 'سطر أول\nسطر ثانٍ\nسطر ثالث');
  fs.mkdirSync(path.join(root, '.kunnash', 'skills', 'تلخيص'), { recursive: true });
  fs.writeFileSync(path.join(root, '.kunnash', 'skills', 'تلخيص', 'SKILL.md'),
    '---\nname: تلخيص\ndescription: لخّص في نقاط\n---\n# تلخيص\nثلاث نقاط كحد أقصى.');

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const step = script.shift();
      if (!step) { res.writeHead(500).end('السيناريو انتهى — طلب زائد'); return; }
      step(parsed, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); forgetRoot(root); });
beforeEach(() => { script = []; requests = []; });

const cfg = () => ({ label: 'محاكاة', model: 'mock', apiKey: 'sk-x', baseUrl: `${base}/v1`, dataPolicy: 'allow' });

function run(opts = {}) {
  return runLoop({
    cfg: cfg(),
    systemMessages: [{ role: 'system', content: 'أنت مساعد اختبار.' }],
    messages: opts.messages || [{ role: 'user', content: opts.prompt || 'نفّذ' }],
    ctx: { root, ...opts.ctx },
    onDelta: opts.onDelta,
    onTool: opts.onTool,
    onPermission: opts.onPermission || (() => 'allow'),
    limits: opts.limits,
    signal: opts.signal,
    noTools: opts.noTools,
  });
}

describe('المسار الأساسي', () => {
  test('جولتان: استدعاء read_file ثم رد نهائي — والنتيجة ترجع للنموذج', async () => {
    script = [
      (req, res) => sse(res, [
        textDelta('أقرأ الملف الآن. '),
        callDelta(0, 'c1', 'read_file', '{"path":"ملف.txt"}'),
        finish('tool_calls'),
      ]),
      (req, res) => {
        // الجولة الثانية يجب أن تحمل رسالة tool بالمحتوى المرقّم
        const toolMsg = req.messages.find((m) => m.role === 'tool');
        assert.ok(toolMsg, 'لا رسالة tool في الجولة الثانية');
        assert.match(toolMsg.content, /1\tسطر أول/);
        assert.strictEqual(toolMsg.tool_call_id, 'c1');
        sse(res, [textDelta('الملف فيه ثلاثة أسطر.')]);
      },
    ];
    const chunks = [];
    const toolsSeen = [];
    const res = await run({
      prompt: 'كم سطرًا في ملف.txt؟',
      onDelta: (c) => chunks.push(c),
      onTool: (n, i) => toolsSeen.push([n, i.path]),
    });
    assert.strictEqual(res.stopReason, 'done');
    assert.strictEqual(chunks.join(''), 'أقرأ الملف الآن. الملف فيه ثلاثة أسطر.');
    assert.deepStrictEqual(toolsSeen, [['read_file', 'ملف.txt']]);
    assert.strictEqual(res.usage.calls, 1);
  });

  test('finish_reason:"stop" مع أدوات مجمّعة: الاستدعاءات تحسم (القاعدة ١)', async () => {
    script = [
      (req, res) => sse(res, [
        callDelta(0, 'c1', 'read_file', '{"path":"ملف.txt"}'),
        finish('stop'),                       // مزوّد يكذب في السبب
      ]),
      (req, res) => sse(res, [textDelta('تم.')]),
    ];
    const res = await run({});
    assert.strictEqual(res.usage.calls, 1, 'الاستدعاء أُهمل لأن finish_reason=stop');
  });

  test('وسائط مقطّعة عبر قطع SSE تتجمع حسب index', async () => {
    script = [
      (req, res) => sse(res, [
        callDelta(0, 'c1', 'read_file', '{"pa'),
        callDelta(0, null, null, 'th":"مل'),
        callDelta(0, null, null, 'ف.txt"}'),
        finish('tool_calls'),
      ]),
      (req, res) => sse(res, [textDelta('تم.')]),
    ];
    const res = await run({});
    assert.strictEqual(res.usage.calls, 1);
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg.content, /سطر أول/);
  });
});

describe('الثابت المقدس: لكل tool_call_id رسالة tool', () => {
  const collectToolIds = () => {
    const asst = requests[1].messages.filter((m) => m.role === 'assistant' && m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id));
    const tools = requests[1].messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    return { asst, tools };
  };

  test('اسم أداة مهلوس: رسالة tool بالمتاح واقتراح القريب', async () => {
    script = [
      (req, res) => sse(res, [callDelta(0, 'c1', 'reed_file', '{"path":"ملف.txt"}'), finish('tool_calls')]),
      (req, res) => sse(res, [textDelta('فهمت.')]),
    ];
    await run({});
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg.content, /لا توجد أداة «reed_file»/);
    assert.match(toolMsg.content, /read_file/);           // الاقتراح
    const { asst, tools } = collectToolIds();
    assert.deepStrictEqual(tools, asst);
  });

  test('JSON فاسد: يُصلَح ما يُصلح، وما يستعصي يرد خطأً منظمًا', async () => {
    script = [
      (req, res) => sse(res, [
        // سور ماركداون + فاصلة زائدة — يصلحهما السلّم
        callDelta(0, 'c1', 'read_file', '```json\n{"path":"ملف.txt",}\n```'),
        // فاسد نهائيًا
        callDelta(1, 'c2', 'read_file', '{path: غير قابل'),
        finish('tool_calls'),
      ]),
      (req, res) => sse(res, [textDelta('تم.')]),
    ];
    const res = await run({});
    // العدّاد يعدّ المحاولات لا النجاحات — المحاولة الفاشلة تستهلك من الحد عمدًا
    assert.strictEqual(res.usage.calls, 2);
    const toolMsgs = requests[1].messages.filter((m) => m.role === 'tool');
    assert.strictEqual(toolMsgs.length, 2, 'استدعاءان = رسالتا tool');
    assert.match(toolMsgs[0].content, /سطر أول/);
    assert.match(toolMsgs[1].content, /JSON/);
  });

  test('رفض المستخدم: رسالة tool «رفض المستخدم» لا صمت ولا استثناء', async () => {
    script = [
      (req, res) => sse(res, [callDelta(0, 'c1', 'write_file', '{"path":"جديد.md","content":"نص"}'), finish('tool_calls')]),
      (req, res) => sse(res, [textDelta('حسنًا لن أكتب.')]),
    ];
    const res = await run({ onPermission: () => 'deny' });
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    assert.match(toolMsg.content, /رفض المستخدم/);
    assert.ok(!fs.existsSync(path.join(root, 'جديد.md')), 'الملف كُتب رغم الرفض!');
    assert.strictEqual(res.stopReason, 'done');
  });

  test('معرّف مفقود ومكرر: تُولَّد معرّفات ولا يسقط استدعاء', async () => {
    script = [
      (req, res) => sse(res, [
        callDelta(0, '', 'read_file', '{"path":"ملف.txt"}'),      // بلا id
        callDelta(1, 'c1', 'read_file', '{"path":"ملف.txt"}'),
        callDelta(2, 'c1', 'list_files', '{"pattern":"*.txt"}'),  // مكرر
        finish('tool_calls'),
      ]),
      (req, res) => sse(res, [textDelta('تم.')]),
    ];
    await run({});
    const asst = requests[1].messages.find((m) => m.role === 'assistant' && m.tool_calls);
    const ids = asst.tool_calls.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, 3, 'المعرفات لم تُفرد');
    const toolIds = requests[1].messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    assert.deepStrictEqual(toolIds, ids);
  });
});

describe('الحدود والدوران', () => {
  test('نفس الأداة بنفس الوسائط ثلاثًا: حقن «تكرار» وجولة بلا أدوات', async () => {
    const call = () => (req, res) => sse(res, [callDelta(0, 'c', 'read_file', '{"path":"ملف.txt"}'), finish('tool_calls')]);
    script = [
      call(), call(), call(),
      (req, res) => {
        assert.strictEqual(req.tool_choice, 'none', 'بعد الدوران يجب tool_choice:none');
        sse(res, [textDelta('أعتذر عن التكرار.')]);
      },
    ];
    const res = await run({});
    assert.strictEqual(res.stopReason, 'done');
    const lastTool = requests[3].messages.filter((m) => m.role === 'tool').at(-1);
    assert.match(lastTool.content, /تكرار/);
  });

  test('حد الاستدعاءات يغلق الباقي برسالة ويوقف', async () => {
    script = [
      (req, res) => sse(res, [
        callDelta(0, 'a', 'read_file', '{"path":"ملف.txt"}'),
        callDelta(1, 'b', 'read_file', '{"path":"ملف.txt"}'),
        callDelta(2, 'c', 'read_file', '{"path":"ملف.txt"}'),
        finish('tool_calls'),
      ]),
      (req, res) => sse(res, [textDelta('أختم.')]),
    ];
    const res = await run({ limits: { toolCalls: 1 } });
    const toolMsgs = requests[1].messages.filter((m) => m.role === 'tool');
    assert.strictEqual(toolMsgs.length, 3, 'الكل مغلق رغم الحد');
    assert.match(toolMsgs[1].content, /حد 1 استدعاء/);
    // أ نُفذت (1)، ب حاولت فرُفضت بالحد (2)، ج أُغلقت بعد بلوغه بلا عدّ
    assert.strictEqual(res.usage.calls, 2);
  });

  test('حد الجولات يوقف بخاتمة معلنة لا صمت', async () => {
    const call = (n) => (req, res) => sse(res, [callDelta(0, 'c' + n, 'list_files', `{"pattern":"*${n}*"}`), finish('tool_calls')]);
    script = [call(1), call(2), call(3)];
    const res = await run({ limits: { rounds: 2 } });
    assert.strictEqual(res.stopReason, 'rounds');
    assert.match(res.text, /حد الجولات/);
  });
});

describe('الإلغاء والانقطاع', () => {
  test('الإلغاء وسط التنفيذ: يرجع النص المتراكم بلا استثناء', async () => {
    const ac = new AbortController();
    script = [
      (req, res) => {
        sse(res, [textDelta('بدأت العمل. '), callDelta(0, 'c1', 'read_file', '{"path":"ملف.txt"}'), finish('tool_calls')]);
        setTimeout(() => ac.abort(), 60);  // يُلغى قبل الجولة الثانية.
        // ٦٠ لا ٥: خمسةٌ تكفي على جهاز مطوّر وتضيق على آلة بناء مشتركة،
        // فيسقط الاختبار بلا عطبٍ في الشيفرة — وهذا أسوأ من ألّا يوجد.
      },
    ];
    const res = await run({ signal: ac.signal });
    assert.strictEqual(res.stopReason, 'cancelled');
    assert.match(res.text, /بدأت العمل/);
  });

  test('نموذج لا يدعم tools: نزول لدردشة عادية بإعلان لا انهيار', async () => {
    script = [
      (req, res) => { res.writeHead(400).end('{"error":"tools is not supported"}'); },
      (req, res) => {
        assert.strictEqual(req.tools, undefined, 'الطلب الثاني ما زال يحمل tools');
        sse(res, [textDelta('أهلًا — دردشة عادية.')]);
      },
    ];
    const res = await run({});
    assert.strictEqual(res.stopReason, 'done');
    assert.match(res.text, /لا يدعم الأدوات/);
    assert.match(res.text, /دردشة عادية/);
  });
});

describe('runAgent — النص المحفوظ والعملاء', () => {
  test('التشغيلان يتشاركان الذاكرة عبر النص المحفوظ، والثابت سليم على القرص', async () => {
    const sid = 'sجلسة1';
    script = [
      (req, res) => sse(res, [callDelta(0, 'c1', 'read_file', '{"path":"ملف.txt"}'), finish('tool_calls')]),
      (req, res) => sse(res, [textDelta('فيه ثلاثة أسطر.')]),
    ];
    await runAgent({
      cfg: cfg(), root, sessionId: sid,
      userContent: 'كم سطرًا في ملف.txt؟',
      onPermission: () => 'allow',
    });
    const saved = transcript.load(root, sid);
    assert.ok(transcript.checkInvariant(saved), 'الثابت مكسور في المحفوظ');
    assert.strictEqual(saved.at(-1).content, 'فيه ثلاثة أسطر.');

    // التشغيل الثاني يرى الأول
    script = [
      (req, res) => {
        assert.ok(req.messages.some((m) => m.role === 'tool'), 'ذاكرة الأدوات ضاعت');
        assert.ok(req.messages.some((m) => m.content === 'فيه ثلاثة أسطر.'));
        sse(res, [textDelta('كما قلت: ثلاثة.')]);
      },
    ];
    const res2 = await runAgent({
      cfg: cfg(), root, sessionId: sid,
      userContent: 'ذكّرني بالجواب',
      onPermission: () => 'allow',
    });
    assert.strictEqual(res2.text, 'كما قلت: ثلاثة.');
  });

  test('run_agent: حلقة متداخلة بميزانية مشتركة والنص فقط يرجع', async () => {
    fs.mkdirSync(path.join(root, '.kunnash', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, '.kunnash', 'agents', 'مراجع.md'),
      '---\nname: مراجع\ndescription: يراجع النصوص\n---\nأنت مراجع دقيق.');
    script = [
      // الأم تستدعي العميل
      (req, res) => sse(res, [callDelta(0, 'c1', 'run_agent', '{"agent_id":"مراجع","task":"راجع ملف.txt"}'), finish('tool_calls')]),
      // العميل (طلب مستقل بنظام العميل) يقرأ ثم يرد
      (req, res) => {
        assert.match(req.messages[0].content, /مراجع دقيق/);
        sse(res, [callDelta(0, 'n1', 'read_file', '{"path":"ملف.txt"}'), finish('tool_calls')]);
      },
      (req, res) => sse(res, [textDelta('المراجعة: سليم.')]),
      // الأم تستلم النتيجة وتختم
      (req, res) => {
        const toolMsg = req.messages.filter((m) => m.role === 'tool').at(-1);
        assert.match(toolMsg.content, /المراجعة: سليم/);
        sse(res, [textDelta('انتهى العميل بنجاح.')]);
      },
    ];
    const res = await runAgent({
      cfg: cfg(), root, sessionId: 'sعملاء',
      userContent: 'كلف المراجع',
      onPermission: () => 'allow',
    });
    assert.match(res.text, /انتهى العميل/);
    // run_agent للأم + read_file داخل العميل — ميزانية واحدة مشتركة
    assert.strictEqual(res.usage.calls, 2);
  });
});
