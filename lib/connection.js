// الاتصال بالنموذج — واجهة OpenAI-compatible واحدة.
//
// كُنّاش لا يعرف «مزوّدين» بأسمائهم ولا يحمل قائمة منهم في كوده. يعرف ثلاثة
// حقول: عنوان الخدمة، ومفتاحًا، واسم نموذج. فالانتقال من OpenRouter إلى مزوّد
// مباشر أو إلى نموذج محلي تغييرُ حقلين لا تغييرُ كود — وهذه هي «الطبقة الثابتة
// فوق سوق متقلّب» في صورتها العملية.
//
// م٢ يبني فوق هذا الملف: ربط PKCE، وحفظ المفتاح في Keychain، وقائمة نماذج
// مفلترة على دعم الأدوات، والرصيد، وسياسة البيانات لكل طلب.
// وم٣ يبني فوق مفكّك SSE أدناه: تجميع tool_calls حسب index.

const DEFAULT_SYSTEM_PROMPT = `أنت مساعد ضمن «كُنّاش» — مكتب عمل شخصي يشتغل على مجلد يختاره المستخدم.
اكتب بلغة المستخدم نفسها، وبالعربية الفصحى إن كتب بالعربية.
ليس لديك وصول لملفات المستخدم في هذه المرحلة — ما تراه هو ما أُرفق في الرسالة فقط. إن طلب عملًا على ملف لم يُرفق فاطلب منه إرفاقه.
لا تخترع أرقامًا ولا مصادر. إن نقص ما تحتاجه فاسأل سؤالًا واحدًا محددًا بدل التخمين.
سلّم مسودة يكملها الإنسان: أظهر ما اعتمدت عليه، ولا تدّعِ إنجاز ما لم تفعله.`;

const DEFAULT_CONNECTION = {
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: '',
  apiKey: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

function endpoint(cfg) {
  return String(cfg.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
}

// ترويسة HTTP لا تقبل إلا محارف ASCII. مفتاح فيه حرف عربي أو مسافة غير مرئية
// (وهذا يقع كثيرًا مع اللصق) يُفشل بناء الطلب برسالة من المحرك لا يفهمها أحد،
// فنكشفه هنا برسالة تقول ما العمل.
function authHeaders(cfg) {
  const key = String(cfg.apiKey || '');
  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new Error('المفتاح يحوي محارف غير صالحة (مسافة أو حرف عربي) — انسخه من جديد وألصقه في الإعدادات ⚙️');
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
}

// يرمي رسالة عربية مفهومة بدل رقم حالة عارٍ
async function ensureOk(res, cfg) {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    throw new Error(`رفض ${cfg.label} المفتاح (${res.status}) — راجعه في الإعدادات ⚙️`);
  }
  if (res.status === 404) {
    throw new Error(`لم يجد ${cfg.label} النموذج «${cfg.model}» — تأكد من اسمه بالضبط.`);
  }
  if (res.status === 429) {
    throw new Error(`${cfg.label} يطلب التمهّل (429) — أعد المحاولة بعد قليل.`);
  }
  throw new Error(`فشل الاتصال بـ ${cfg.label} — ${res.status}: ${body.slice(0, 300)}`);
}

// مفكّك SSE يدوي: لا نعتمد على عميل خاص بمزوّد
async function streamChat({ cfg, messages, onDelta }) {
  const res = await fetch(endpoint(cfg), {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
  });
  await ensureOk(res, cfg);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        const chunk = delta && delta.content;
        if (chunk) { full += chunk; if (onDelta) onDelta(chunk); }
      } catch { /* سطر غير مكتمل — يتجاهل */ }
    }
  }

  return full;
}

// اختبار المفتاح والنموذج معًا بأقل كلفة ممكنة
async function testConnection(cfg) {
  const res = await fetch(endpoint(cfg), {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'رد بكلمة واحدة فقط: تم' }],
      stream: false,
    }),
  });
  await ensureOk(res, cfg);
  const json = await res.json();
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return (content || '').trim().slice(0, 60) || 'تم الاتصال';
}

module.exports = { DEFAULT_CONNECTION, DEFAULT_SYSTEM_PROMPT, streamChat, testConnection };
