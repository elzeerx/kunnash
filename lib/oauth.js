// ربط OpenRouter بضغطة — PKCE (S256) مع callback على localhost.
//
// المسار المؤكَّد بالفحص: openrouter.ai/auth?callback_url=…&code_challenge=…
// يرجع ?code= على العنوان المحلي، ثم POST /api/v1/auth/keys بالكود والمُتحقِّق
// فيرجع مفتاح المستخدم. لا سرّ عميل ولا تسجيل مسبق — localhost مقبول دائمًا.
//
// الأمان: الخادم يستمع على 127.0.0.1 فقط ويقبل طلبًا واحدًا ثم يُغلق.
// لا حاجة لـstate: الكود بلا code_verifier عديم القيمة، والمُتحقِّق لا يغادر
// العملية. الوحدة لا تعرف Electron — فتح المتصفح يُحقن دالةً من main.

const http = require('http');
const crypto = require('crypto');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SUCCESS_PAGE = `<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>تم الربط</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;background:#FAF8F4;color:#26241F">
<div style="text-align:center"><h2>✅ تم ربط كُنّاش بحسابك</h2><p>ارجع إلى التطبيق — يمكنك إغلاق هذه الصفحة.</p></div>
</body></html>`;

const FAIL_PAGE = `<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>لم يكتمل الربط</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:90vh;background:#FAF8F4;color:#26241F">
<div style="text-align:center"><h2>⚠️ لم يصل رمز الربط</h2><p>ارجع إلى كُنّاش وحاول من جديد.</p></div>
</body></html>`;

/**
 * يشغّل تدفق الربط كاملًا ويرجع مفتاح API.
 *
 * @param {object} opts
 * @param {(url: string) => void} opts.openUrl   يفتح المتصفح (shell.openExternal)
 * @param {string} [opts.authBase]               أصل صفحة الموافقة
 * @param {string} [opts.apiBase]                أصل الواجهة البرمجية
 * @param {number} [opts.timeoutMs]              مهلة انتظار المستخدم
 * @param {(cancel: () => void) => void} [opts.onCancelHandle]  يسلَّم مقبض إلغاء
 * @returns {Promise<{ apiKey: string }>}
 */
async function linkOpenRouter({
  openUrl,
  authBase = 'https://openrouter.ai',
  apiBase = 'https://openrouter.ai/api/v1',
  timeoutMs = 5 * 60 * 1000,
  onCancelHandle,
} = {}) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('انتهت مهلة الربط (٥ دقائق) — أعد المحاولة من الإعدادات.'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      server.close();
    }
    if (onCancelHandle) {
      onCancelHandle(() => {
        cleanup();
        reject(new Error('أُلغي الربط.'));
      });
    }

    server.on('request', (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const c = u.searchParams.get('code');
      // المتصفح قد يطلب favicon وغيره — نتجاهل كل ما ليس رمزًا
      if (!c) {
        if (u.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(FAIL_PAGE);
        } else {
          res.writeHead(404).end();
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_PAGE);
      cleanup();
      resolve(c);
    });

    const authUrl = `${authBase}/auth?callback_url=${encodeURIComponent(`http://127.0.0.1:${port}`)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256`;
    openUrl(authUrl);
  });

  // تبادل الكود بالمفتاح
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`فشل تبادل رمز الربط — ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const apiKey = json.key || (json.data && json.data.key);
  if (!apiKey) throw new Error('رد الربط بلا مفتاح — أعد المحاولة.');
  return { apiKey };
}

module.exports = { linkOpenRouter, _b64url: b64url };
