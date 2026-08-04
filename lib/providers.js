// مزودو النماذج عبر واجهة OpenAI-compatible موحدة.
// المفكّك اليدوي لبث SSE أدناه هو نقطة انطلاق عميل OpenRouter في م٢.
//
// في هذه المرحلة النماذج للدردشة والصياغة فقط: لا حلقة أدوات ولا وصول لملفات
// مساحة العمل — المرفقات وحدها تُمرَّر مضمَّنة في الرسالة.

const DEFAULT_SYSTEM_PROMPT = `أنت مساعد ضمن «كُنّاش» — مكتب عمل شخصي يشتغل على مجلد يختاره المستخدم.
دورك: الصياغة، التلخيص، العصف الذهني، والرأي الثاني.
اكتب بلغة المستخدم نفسها، وبالعربية الفصحى إن كتب بالعربية.
ليس لديك وصول لملفات المستخدم في هذه المرحلة — ما تراه هو ما أُرفق في الرسالة فقط. إن طلب عملًا على ملف لم يُرفق فاطلب منه إرفاقه.
لا تخترع أرقامًا ولا مصادر. إن نقص ما تحتاجه فاسأل سؤالًا واحدًا محددًا بدل التخمين.
سلّم مسودة يكملها الإنسان: أظهر ما اعتمدت عليه، ولا تدّعِ إنجاز ما لم تفعله.`;

const PROVIDER_DEFAULTS = {
  gpt: {
    label: 'GPT — OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    apiKey: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
  kimi: {
    label: 'KIMI — Moonshot',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3',
    apiKey: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
  glm: {
    label: 'GLM — Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.6',
    apiKey: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },
};

async function streamProviderChat({ cfg, messages, onDelta }) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`فشل الاتصال بـ ${cfg.label} — ${res.status}: ${body.slice(0, 300)}`);
  }

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

// اختبار سريع للمفتاح: طلب غير متدفق بأقل كلفة ممكنة
async function testProvider(cfg) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'رد بكلمة واحدة فقط: تم' }],
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return (content || '').trim().slice(0, 60) || 'تم الاتصال';
}

module.exports = { PROVIDER_DEFAULTS, streamProviderChat, testProvider, DEFAULT_SYSTEM_PROMPT };
