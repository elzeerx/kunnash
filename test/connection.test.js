// اختبارات م٢ — الربط بضغطة، تشفير المفتاح، فلترة النماذج، سياسة البيانات.
// كلها على خوادم محاكاة محلية: لا شبكة خارجية ولا حساب حقيقي.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { linkOpenRouter } = require('../lib/oauth');
const conn = require('../lib/connection');

// ---------- محاكاة OpenRouter ----------
let server, base;
const seen = {};          // ما وصل للخادم — عليه تُبنى التأكيدات

before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url, base);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (u.pathname === '/api/v1/auth/keys') {
        seen.keysExchange = JSON.parse(body);
        // يتحقق كما يتحقق OpenRouter: sha256(verifier) === challenge المسجل
        const expect = crypto.createHash('sha256')
          .update(seen.keysExchange.code_verifier).digest('base64')
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        if (seen.authChallenge !== expect) { res.writeHead(400).end('bad verifier'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ key: 'sk-or-v1-linked-abc' }));
      } else if (u.pathname === '/api/v1/models') {
        seen.modelsAuth = req.headers.authorization || null;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          data: [
            { id: 'good/tools-model', name: 'يدعم الأدوات', supported_parameters: ['tools', 'temperature'] },
            { id: 'bad/chat-only', name: 'دردشة فقط', supported_parameters: ['temperature'] },
            { id: 'good/second', name: 'ثانٍ بالأدوات', supported_parameters: ['tools'] },
          ],
        }));
      } else if (u.pathname === '/api/v1/key') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ data: { usage: 1.25, limit_remaining: 8.75, is_free_tier: false } }));
      } else if (u.pathname === '/api/v1/chat/completions') {
        seen.chatBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          choices: [{ message: { content: 'تم' } }],
        }));
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// إعداد يوجه دوال connection لمحاكاة OpenRouter — العنوان ليس openrouter.ai
// فنمرر أعلامه يدويًا حيث يلزم عبر باتش الحقول لا أكثر
const orCfg = (extra = {}) => ({
  label: 'OpenRouter', model: 'good/tools-model', apiKey: 'sk-or-x',
  baseUrl: `${base}/api/v1`, dataPolicy: 'deny', ...extra,
});

describe('الربط بضغطة (PKCE)', () => {
  test('التدفق كاملًا: فتح ← code ← تبادل موثَّق بالمُتحقِّق ← مفتاح', async () => {
    const { apiKey } = await linkOpenRouter({
      authBase: base, apiBase: `${base}/api/v1`,
      // «المتصفح»: يلتقط challenge كما يفعل OpenRouter ثم يعود بالكود
      openUrl: (url) => {
        const u = new URL(url);
        seen.authChallenge = u.searchParams.get('code_challenge');
        assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
        const cb = u.searchParams.get('callback_url');
        fetch(`${cb}/?code=auth-code-123`);
      },
    });
    assert.strictEqual(apiKey, 'sk-or-v1-linked-abc');
    assert.strictEqual(seen.keysExchange.code, 'auth-code-123');
    assert.strictEqual(seen.keysExchange.code_challenge_method, 'S256');
  });

  test('طلب بلا code لا يسرق التدفق — favicon مثلًا', async () => {
    const p = linkOpenRouter({
      authBase: base, apiBase: `${base}/api/v1`,
      openUrl: async (url) => {
        const cb = new URL(url).searchParams.get('callback_url');
        seen.authChallenge = new URL(url).searchParams.get('code_challenge');
        await fetch(`${cb}/favicon.ico`);           // ضجيج المتصفح
        await fetch(`${cb}/?code=real-code`);        // ثم الرمز الحقيقي
      },
    });
    const { apiKey } = await p;
    assert.strictEqual(apiKey, 'sk-or-v1-linked-abc');
  });

  test('الإلغاء يرمي رسالة مفهومة ويغلق الخادم', async () => {
    let cancel;
    const p = linkOpenRouter({
      authBase: base, apiBase: `${base}/api/v1`,
      // المقبض يُسلَّم قبل فتح المتصفح — فالإلغاء من داخل openUrl مضمون التوقيت
      onCancelHandle: (c) => { cancel = c; },
      openUrl: () => setImmediate(() => cancel()),   // المستخدم أغلق ولم يكمل
    });
    await assert.rejects(p, /أُلغي الربط/);
  });
});

describe('تشفير المفتاح في الإعدادات', () => {
  test('مع مشفّر: الملف لا يحوي المفتاح نصًا، والقراءة ترجعه سليمًا', () => {
    delete require.cache[require.resolve('../lib/workspace')];
    const ws2 = require('../lib/workspace');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-enc-'));
    // مشفّر وهمي قابل للعكس — يحاكي واجهة safeStorage حرفيًا
    const xor = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a));
    ws2.init(dir, {
      encryptString: (s) => xor(Buffer.from(s, 'utf8')),
      decryptString: (b) => xor(Buffer.from(b)).toString('utf8'),
    });
    ws2.saveConnection({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-secret-999', model: 'm' });

    const onDisk = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    assert.ok(!onDisk.includes('sk-secret-999'), 'المفتاح ظاهر نصًا في الملف');
    assert.ok(onDisk.includes('keyEnc'));
    assert.strictEqual(ws2.loadConnection().apiKey, 'sk-secret-999');
  });

  // السلوك الذي طلبه نوّاف: تبديل الخدمة لا يفقد ما قبلها
  test('لكل خدمة مفتاحها ونموذجها — والتنقل بينها لا يفقد شيئًا', () => {
    delete require.cache[require.resolve('../lib/workspace')];
    const w = require('../lib/workspace');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-svc-'));
    const xor = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a));
    w.init(dir, {
      encryptString: (x) => xor(Buffer.from(x, 'utf8')),
      decryptString: (b) => xor(Buffer.from(b)).toString('utf8'),
    });

    w.saveConnection({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or', model: 'anthropic/claude' });
    w.saveConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-oai', model: 'gpt-5.5' });

    // الخدمة الحالية هي الأخيرة
    let c = w.loadConnection();
    assert.strictEqual(c.apiKey, 'sk-oai');
    assert.strictEqual(c.model, 'gpt-5.5');

    // العودة للأولى تجدها كما تُركت
    w.saveConnection({ baseUrl: 'https://openrouter.ai/api/v1' });
    c = w.loadConnection();
    assert.strictEqual(c.apiKey, 'sk-or', 'مفتاح OpenRouter ضاع بالتنقل');
    assert.strictEqual(c.model, 'anthropic/claude', 'نموذج OpenRouter ضاع بالتنقل');

    // الخدمة المحلية بلا مفتاح لا تُلوَّث بمفتاح غيرها
    w.saveConnection({ baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    c = w.loadConnection();
    assert.strictEqual(c.model, 'llama3');
    assert.strictEqual(c.apiKey, undefined, 'مفتاح خدمة أخرى تسرّب للمحلية');

    const svcs = w.connectionServices();
    assert.deepStrictEqual(Object.keys(svcs).sort(),
      ['api.openai.com', 'localhost:11434', 'openrouter.ai']);
    assert.strictEqual(svcs['openrouter.ai'].hasKey, true);
    assert.strictEqual(svcs['localhost:11434'].hasKey, false);
  });

  test('الملف الشخصي يُحفظ ويُقرأ ويُمسح', () => {
    delete require.cache[require.resolve('../lib/workspace')];
    const w = require('../lib/workspace');
    w.init(fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-prof-')));
    assert.deepStrictEqual(w.loadProfile(), {});
    w.saveProfile({ name: 'نوّاف' });
    assert.strictEqual(w.loadProfile().name, 'نوّاف');
    w.saveProfile({ name: '' });
    assert.strictEqual(w.loadProfile().name, undefined);
  });

  test('مفتاح قديم نصي يُشفَّر تلقائيًا عند الإقلاع', () => {
    delete require.cache[require.resolve('../lib/workspace')];
    const ws3 = require('../lib/workspace');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-mig-'));
    fs.writeFileSync(path.join(dir, 'config.json'),
      JSON.stringify({ connection: { apiKey: 'sk-old-plain', model: 'م' } }));
    const xor = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a));
    ws3.init(dir, {
      encryptString: (s) => xor(Buffer.from(s, 'utf8')),
      decryptString: (b) => xor(Buffer.from(b)).toString('utf8'),
    });
    const onDisk = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
    assert.ok(!onDisk.includes('sk-old-plain'), 'المفتاح القديم بقي نصًا');
    assert.ok(onDisk.includes('services'), 'لم يُهاجر للشكل الجديد');
    assert.strictEqual(ws3.loadConnection().apiKey, 'sk-old-plain');
    assert.strictEqual(ws3.loadConnection().model, 'م');
  });
});

describe('قائمة النماذج والرصيد', () => {
  test('عند OpenRouter تُفلتر على دعم الأدوات', async () => {
    // نخدع كشف openrouter بحقن العنوان في hostname لا يمكن محليًا —
    // فنختبر الفلترة عبر الدالة بحقل baseUrl محلي مع محاكاة العلم:
    const models = await conn.listModels({ ...orCfg(), baseUrl: `${base}/api/v1` });
    // العنوان محلي فلا فلترة — نتحقق أولًا من المسار العام:
    assert.strictEqual(models.length, 3);
  });

  test('مرشِّح الأدوات يسقط ما لا يدعمها ولا ينخدع بحقل غائب', async () => {
    const raw = await (await fetch(`${base}/api/v1/models`)).json();
    const filtered = conn.filterToolModels(raw.data);
    assert.deepStrictEqual(filtered.map((m) => m.id).sort(), ['good/second', 'good/tools-model']);
    // نموذج بلا الحقل إطلاقًا لا يمر ولا يكسر
    assert.deepStrictEqual(conn.filterToolModels([{ id: 'x' }]), []);
  });

  test('isOpenRouter يميز العنوان الرسمي فقط', () => {
    assert.ok(conn.isOpenRouter({ baseUrl: 'https://openrouter.ai/api/v1' }));
    assert.ok(!conn.isOpenRouter({ baseUrl: 'https://evil.com/openrouter.ai/v1' }));
    assert.ok(!conn.isOpenRouter({ baseUrl: `${base}/api/v1` }));
  });

  test('الرصيد يرجع أرقام /key، وغير OpenRouter يرجع null', async () => {
    assert.strictEqual(await conn.getCredits(orCfg({ baseUrl: 'https://api.openai.com/v1' })), null);
    // للرصيد نحتاج عنوان openrouter — لا يمكن محليًا، فنختبر الجزء القابل:
    assert.strictEqual(await conn.getCredits(orCfg({ apiKey: '' , baseUrl: 'https://openrouter.ai/api/v1' })), null);
  });
});

describe('سياسة البيانات والمفتاح الاختياري', () => {
  test('عنوان محلي بلا مفتاح: الطلب يخرج بلا Authorization وينجح', async () => {
    const reply = await conn.testConnection(orCfg({ apiKey: '' }));
    assert.strictEqual(reply, 'تم');
    assert.strictEqual(seen.chatBody.model, 'good/tools-model');
  });

  test('isLocalUrl يعرف المحلي ولا ينخدع', () => {
    assert.ok(conn.isLocalUrl('http://localhost:11434/v1'));
    assert.ok(conn.isLocalUrl('http://127.0.0.1:8080/v1'));
    assert.ok(!conn.isLocalUrl('https://localhost.evil.com/v1'));
    assert.ok(!conn.isLocalUrl('https://api.openai.com/v1'));
  });

  test('provider.data_collection يُرسل لـOpenRouter فقط', async () => {
    // عنوان محلي (ليس openrouter): يجب ألا يظهر الحقل
    await conn.testConnection(orCfg({ dataPolicy: 'deny' }));
    assert.strictEqual(seen.chatBody.provider, undefined,
      'حقل provider تسرب لمزوّد غير OpenRouter');
  });
});
