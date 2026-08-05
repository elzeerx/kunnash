// الاتصال بالنموذج — واجهة OpenAI-compatible واحدة.
//
// كُنّاش لا يحمل «قائمة مزوّدين» بالمعنى القديم: الاتصال ثلاثة حقول (عنوان،
// نموذج، مفتاح) وأي خدمة تتكلم لغة OpenAI تعمل. القوائم أدناه «تعبئة جاهزة»
// فقط — أزرار تملأ الحقول ثم تختفي من الصورة، ولا يمرّ عليها الكود بعد ذلك.
//
// قرار مثبّت (بموافقة نوّاف، أغسطس ٢٠٢٦): لا مسار لاشتراكات المستهلكين.
// اشتراك ChatGPT لا يتيح نداءات API رسميًا، واشتراك Claude محظور رسميًا في
// أدوات الطرف الثالث منذ فبراير ٢٠٢٦. البديل المشروع: مفاتيح API المباشرة —
// ولذلك presets لأنثروبيك وOpenAI بجانب OpenRouter، والخيار للمستخدم.

const DEFAULT_SYSTEM_PROMPT = `أنت مساعد ضمن «كُنّاش» — مكتب عمل شخصي يشتغل على مجلد يختاره المستخدم.
اكتب بلغة المستخدم نفسها، وبالعربية الفصحى إن كتب بالعربية.
ليس لديك وصول لملفات المستخدم في هذه المرحلة — ما تراه هو ما أُرفق في الرسالة فقط. إن طلب عملًا على ملف لم يُرفق فاطلب منه إرفاقه.
لا تخترع أرقامًا ولا مصادر. إن نقص ما تحتاجه فاسأل سؤالًا واحدًا محددًا بدل التخمين.
سلّم مسودة يكملها الإنسان: أظهر ما اعتمدت عليه، ولا تدّعِ إنجاز ما لم تفعله.`;

// تعبئة جاهزة — تُعرض في الإعدادات وتملأ الحقول، لا أكثر.
// hint يُعرض تحت الأزرار ليعرف المستخدم من أين يجيء المفتاح.
const PRESETS = [
  {
    id: 'openrouter', label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    hint: 'نماذج كثيرة بمفتاح واحد — والربط بضغطة زر، أو مفتاح من openrouter.ai/keys',
    needsKey: true,
  },
  {
    id: 'anthropic', label: 'Anthropic — Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: 'مفتاح API من console.anthropic.com (غير اشتراك Claude الشهري)',
    needsKey: true, exampleModel: 'claude-sonnet-4-5',
  },
  {
    id: 'openai', label: 'OpenAI — GPT',
    baseUrl: 'https://api.openai.com/v1',
    hint: 'مفتاح API من platform.openai.com (غير اشتراك ChatGPT الشهري)',
    needsKey: true, exampleModel: 'gpt-5.5',
  },
  {
    id: 'ollama', label: 'Ollama — على جهازك',
    baseUrl: 'http://localhost:11434/v1',
    hint: 'نموذج محلي بلا مفتاح ولا إنترنت — يحتاج تطبيق Ollama مشغَّلًا',
    needsKey: false,
  },
];

const DEFAULT_CONNECTION = {
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: '',
  apiKey: '',
  dataPolicy: 'deny',       // OpenRouter فقط: لا تمرير لمزوّد يتدرّب على البيانات
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

// التمييز على hostname المُحلَّل لا على نص الرابط — فحص النص يقبل
// evil.com/openrouter.ai أو يرفض الرابط الصحيح حسب موضع السلسلة
function hostnameOf(baseUrl) {
  try { return new URL(String(baseUrl || '')).hostname.toLowerCase(); } catch { return ''; }
}
function isOpenRouter(cfg) {
  const h = hostnameOf(cfg.baseUrl);
  return h === 'openrouter.ai' || h.endsWith('.openrouter.ai');
}
// خدمة محلية (Ollama وأخواته) لا تحتاج مفتاحًا
function isLocalUrl(baseUrl) {
  const h = hostnameOf(baseUrl);
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function endpoint(cfg, path = '/chat/completions') {
  return String(cfg.baseUrl || '').replace(/\/+$/, '') + path;
}

// ترويسة HTTP لا تقبل إلا محارف ASCII. مفتاح فيه حرف عربي أو مسافة غير مرئية
// (وهذا يقع كثيرًا مع اللصق) يُفشل بناء الطلب برسالة من المحرك لا يفهمها أحد،
// فنكشفه هنا برسالة تقول ما العمل. والمفتاح اختياري: الخدمات المحلية بلا مفتاح.
function authHeaders(cfg) {
  const key = String(cfg.apiKey || '');
  const headers = { 'Content-Type': 'application/json' };
  if (!key) return headers;
  if (!/^[\x21-\x7E]+$/.test(key)) {
    throw new Error('المفتاح يحوي محارف غير صالحة (مسافة أو حرف عربي) — انسخه من جديد وألصقه في الإعدادات ⚙️');
  }
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

// يرمي رسالة عربية مفهومة بدل رقم حالة عارٍ
async function ensureOk(res, cfg) {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    throw new Error(`رفض ${cfg.label} المفتاح (${res.status}) — راجعه في الإعدادات ⚙️`);
  }
  if (res.status === 404) {
    // «لا فلترة صامتة»: مع سياسة منع التدريب قد لا يبقى مزوّد مطابق — يُقال صراحة
    if (isOpenRouter(cfg) && cfg.dataPolicy !== 'allow') {
      throw new Error(`لم يوجد مزوّد للنموذج «${cfg.model}» يوافق سياسة «لا تدريب على بياناتك». خياراتك: بدّل النموذج، أو اسمح مؤقتًا من الإعدادات ⚙️، أو ألغِ.`);
    }
    throw new Error(`لم يجد ${cfg.label} النموذج «${cfg.model}» — تأكد من اسمه بالضبط.`);
  }
  if (res.status === 429) {
    throw new Error(`${cfg.label} يطلب التمهّل (429) — أعد المحاولة بعد قليل.`);
  }
  throw new Error(`فشل الاتصال بـ ${cfg.label} — ${res.status}: ${body.slice(0, 300)}`);
}

function buildBody(cfg, messages, stream, extra = {}) {
  const body = { model: cfg.model, messages, stream, ...extra };
  // سياسة البيانات وusage حقلان خاصان بـOpenRouter — لا يُرسلان لغيره
  if (isOpenRouter(cfg)) {
    if (cfg.dataPolicy !== 'allow') body.provider = { data_collection: 'deny' };
    if (stream) body.usage = { include: true };
  }
  return body;
}

// ---------- جولة بث واحدة للحلقة ----------
// يجمع النص وtool_calls معًا: القطع تصل بأي تقطيع، والاستدعاءات تتراكم حسب
// index (الاسم والمعرّف في أول قطعة، وarguments نص يُلحق قطعةً قطعة).
// إعادة المحاولة على 429/5xx تسبق أول بايت فقط — بعد وصول بايت لا يُعاد
// الطلب نفسه أبدًا (تكرار نص أمام المستخدم)، بل يُرجَع ما وصل بعلم interrupted.
async function streamRound({ cfg, messages, tools, toolChoice, onDelta, signal }) {
  const extra = {};
  if (tools && tools.length) {
    extra.tools = tools;
    extra.tool_choice = toolChoice || 'auto';
  }

  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(endpoint(cfg), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(buildBody(cfg, messages, true, extra)),
      signal,
    });
    if (res.ok) break;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = retryAfter > 0 ? retryAfter * 1000
        : (2 ** attempt) * 1000 + Math.random() * 400;
      await res.text().catch(() => {});
      await new Promise((r, j) => {
        const t = setTimeout(r, wait);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); j(new DOMException('aborted', 'AbortError')); }, { once: true });
      });
      continue;
    }
    await ensureOk(res, cfg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = null;
  let usage = null;
  let interrupted = false;
  const calls = [];   // حسب index

  try {
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
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        if (json.usage) usage = json.usage;
        const choice = json.choices && json.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) { text += delta.content; if (onDelta) onDelta(delta.content); }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          if (!calls[i]) calls[i] = { id: '', name: '', args: '' };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function && tc.function.name) calls[i].name += tc.function.name;
          if (tc.function && typeof tc.function.arguments === 'string') calls[i].args += tc.function.arguments;
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // انقطاع وسط البث: نُرجع ما وصل — الحلقة تقرر (لا إعادة حرفية بعد أول بايت)
    interrupted = true;
  }

  return { text, toolCalls: calls.filter(Boolean), finishReason, usage, interrupted };
}

// مفكّك SSE يدوي: لا نعتمد على عميل خاص بمزوّد
async function streamChat({ cfg, messages, onDelta }) {
  const res = await fetch(endpoint(cfg), {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(buildBody(cfg, messages, true)),
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
    body: JSON.stringify(buildBody(cfg, [{ role: 'user', content: 'رد بكلمة واحدة فقط: تم' }], false)),
  });
  await ensureOk(res, cfg);
  const json = await res.json();
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return (content || '').trim().slice(0, 60) || 'تم الاتصال';
}

// قائمة النماذج — GET /models قياسية عند الجميع.
// عند OpenRouter تُفلتر على دعم الأدوات: هذا هو العلاج الجذري لعطل «أدوات
// كنص» في م٣ — نموذج لا يفهم tools لا يُعرض أصلًا.
function filterToolModels(items) {
  return items.filter((m) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'));
}

async function listModels(cfg) {
  const res = await fetch(endpoint(cfg, '/models'), { headers: authHeaders(cfg) });
  await ensureOk(res, cfg);
  const json = await res.json();
  let items = json.data || [];
  if (isOpenRouter(cfg)) items = filterToolModels(items);
  return items
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// الرصيد والاستهلاك — خاص بـOpenRouter (GET /key). غيره يرجع null بلا خطأ.
async function getCredits(cfg) {
  if (!isOpenRouter(cfg) || !cfg.apiKey) return null;
  const res = await fetch(endpoint(cfg, '/key'), { headers: authHeaders(cfg) });
  await ensureOk(res, cfg);
  const { data } = await res.json();
  if (!data) return null;
  return {
    usage: data.usage ?? null,                       // ما استُهلك بالدولار
    remaining: data.limit_remaining ?? null,         // null = بلا حد
    isFreeTier: Boolean(data.is_free_tier),
  };
}

module.exports = {
  PRESETS, DEFAULT_CONNECTION, DEFAULT_SYSTEM_PROMPT,
  isOpenRouter, isLocalUrl, filterToolModels,
  streamChat, streamRound, testConnection, listModels, getCredits,
};
