// اختبار الدردشة من طرف إلى طرف — بخادم محاكاة يتكلم SSE كما يتكلمه أي مزوّد
// OpenAI-compatible. يثبت عقد الأحداث كاملًا بلا Electron وبلا شبكة خارجية،
// وهو الحارس الثابت لعقد chat:* الذي تبني عليه حلقة م٣.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ws = require('../lib/workspace');
const core = require('../lib/core');
const { forgetRoot } = require('../lib/paths');

let server;
let baseUrl;
let root;
let lastRequest;            // آخر جسم طلب وصل للخادم — للتحقق من بنية الرسائل
let mode = 'stream';        // stream · fail-500 · fail-401

before(async () => {
  // مساحة عمل وإعدادات معزولتان تمامًا عن أي شيء على الجهاز
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-chat-ud-'));
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-chat-ws-'));
  ws.init(userData);
  ws.setWorkspace(root);

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastRequest = JSON.parse(body);
      if (mode === 'fail-500') { res.writeHead(500).end('انفجار داخلي'); return; }
      if (mode === 'fail-401') { res.writeHead(401).end('bad key'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // قطع عمدًا غير مصطفة مع حدود الأسطر لاختبار المفكّك
      const chunks = ['مرحبًا', ' بك', ' في كُنّاش'];
      for (const c of chunks) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  core.saveConnection({ label: 'محاكاة', baseUrl, model: 'mock-1', apiKey: 'sk-mock' });
});

after(() => { server.close(); forgetRoot(); });

function collect() {
  const events = [];
  return { events, emit: (ch, p) => events.push({ ch, ...p }) };
}

describe('المسار السعيد', () => {
  test('بث كامل: started ← دلتات ← done، والنص يتجمع بالترتيب', async () => {
    const { events, emit } = collect();
    const res = await core.chatSend({ text: 'اختبار', requestId: 'r1' }, emit);

    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(events.map((e) => e.ch),
      ['chat:started', 'chat:delta', 'chat:delta', 'chat:delta', 'chat:done']);
    const streamed = events.filter((e) => e.ch === 'chat:delta').map((e) => e.chunk).join('');
    assert.strictEqual(streamed, 'مرحبًا بك في كُنّاش');
    assert.strictEqual(events.at(-1).text, 'مرحبًا بك في كُنّاش');
    // كل حدث يحمل هوية تشغيله
    for (const e of events) {
      assert.strictEqual(e.requestId, 'r1');
      assert.ok(e.sessionId);
    }
  });

  test('الجلسة حُفظت في ‎.kunnash‎ برسالتين ونموذجها مسجَّل', () => {
    const sessions = core.loadSessions();
    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(s.messages.length, 2);
    assert.strictEqual(s.messages[0].role, 'user');
    assert.strictEqual(s.messages[1].text, 'مرحبًا بك في كُنّاش');
    assert.strictEqual(s.model, 'mock-1');
    assert.ok(fs.existsSync(path.join(root, '.kunnash', 'sessions.json')));
  });

  test('الطلب الواصل للمزوّد: نظام أولًا، ثم التاريخ، وstream مفعّل', () => {
    assert.strictEqual(lastRequest.model, 'mock-1');
    assert.strictEqual(lastRequest.stream, true);
    assert.strictEqual(lastRequest.messages[0].role, 'system');
    assert.strictEqual(lastRequest.messages.at(-1).role, 'user');
    assert.strictEqual(lastRequest.messages.at(-1).content, 'اختبار');
  });

  test('الرد التالي في نفس الجلسة يحمل التاريخ كاملًا', async () => {
    const sid = core.loadSessions()[0].id;
    const { emit } = collect();
    await core.chatSend({ sessionId: sid, text: 'وسؤال ثانٍ', requestId: 'r2' }, emit);
    const roles = lastRequest.messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ['system', 'user', 'assistant', 'user']);
    assert.strictEqual(core.loadSessions().length, 1, 'لا جلسة جديدة');
  });
});

describe('مسار الفشل', () => {
  test('خطأ 500 يُبث chat:error برسالة مترجمة ويحفظ رسالة المستخدم', async () => {
    mode = 'fail-500';
    const { events, emit } = collect();
    const res = await core.chatSend({ text: 'سيفشل', requestId: 'r3' }, emit);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(events.at(-1).ch, 'chat:error');
    assert.match(events.at(-1).message, /فشل الاتصال بـ محاكاة — 500/);
    // رسالة المستخدم محفوظة كي يعمل زر إعادة المحاولة بعد إعادة الفتح
    const s = core.loadSessions().find((x) => x.messages.some((m) => m.text === 'سيفشل'));
    assert.ok(s);
  });

  test('خطأ 401 يترجم لرسالة مفتاح لا لرقم عارٍ', async () => {
    mode = 'fail-401';
    const { events, emit } = collect();
    await core.chatSend({ text: 'x', requestId: 'r4' }, emit);
    assert.match(events.at(-1).message, /رفض محاكاة المفتاح \(401\)/);
    mode = 'stream';
  });

  test('إعادة المحاولة لا تكرر رسالة المستخدم', async () => {
    const s0 = core.loadSessions().find((x) => x.messages.some((m) => m.text === 'سيفشل'));
    const before = s0.messages.filter((m) => m.text === 'سيفشل').length;
    const { emit } = collect();
    await core.chatSend({ sessionId: s0.id, text: 'سيفشل', retry: true, requestId: 'r5' }, emit);
    const s1 = core.getSession(s0.id);
    assert.strictEqual(s1.messages.filter((m) => m.text === 'سيفشل').length, before);
  });
});
