// مدخل العميل — يبني رسائل النظام، يدير النص المحفوظ، ويشغّل الحلقة.
//
// بديل runClaude بتوقيع مكافئ (§٥): sessionId نولّده نحن والنص كامل في
// مساحة العمل، فالاستئناف معرّف نصي يعمل عبر الأجهزة.
//
// قيد التخزين المؤقت (§٩): رسائل النظام تُبنى مرة لكل تشغيل وتبقى متطابقة
// بايتًا ببايت عبر الجولات — لا طوابع زمنية ولا عدّادات، وفهرس المهارات
// يُقرأ من القرص عند بدء التشغيل لا في منتصفه.

const fs = require('fs');
const path = require('path');

const { runLoop } = require('./loop');
const transcript = require('./transcript');
const library = require('../library');

const RULES = `أنت كُنّاش — مكتب عمل شخصي ينفّذ مهام المستخدم داخل مجلد عمله عبر الأدوات.
القواعد:
- اعمل على الملفات بالأدوات وبمسارات نسبية من جذر مساحة العمل. لا تخمّن محتوى ملف — اقرأه.
- احفظ كل مخرَج تُنشئه في مجلد «المخرجات/» ما لم يحدد المستخدم غيره، واذكر مسار كل ملف أنشأته داخل علامتي باكتيك مثل \`المخرجات/تقرير.docx\` ليصير رابطًا قابلًا للنقر.
- سلّم مسودة يكملها الإنسان: لا ترسل بريدًا ولا تعتمد شيئًا نيابة عن أحد.
- المهام المركّبة: دوّن خطتك بـtodo_write وحدّثها مع التقدم.
- قبل تنفيذ مهمة لها مهارة مطابقة في الفهرس أدناه: اقرأها بـread_skill والتزم خطواتها.
- إن طلب المستخدم إنشاء مهارة أو عميل أو تعديلهما فاستعمل save_skill (لا write_file) — مكتبته محمية ولا تُكتب مباشرة.
- لا تخترع أرقامًا ولا مصادر، ولا تدّعِ إنجاز ما لم تفعله.
- اكتب بلغة المستخدم، وبالعربية الفصحى إن كتب بالعربية.`;

const INDEX_CAP = 1200 * 4;   // ~١٢٠٠ رمز — الفهرس مضغوط عمدًا (النسبة ١:١٥ هي الحجة)

function buildIndex(root) {
  const { skills, agents } = library.listLibrary(root);
  const line = (s) => `- ${s.id} — ${(s.description || s.name || '').slice(0, 200)}`;
  let out = '';
  if (skills.length) out += 'فهرس المهارات (اقرأ أيّها بـread_skill قبل تنفيذها):\n' + skills.map(line).join('\n');
  if (agents.length) out += (out ? '\n\n' : '') + 'فهرس العملاء (كلّف أيّهم بـrun_agent):\n' + agents.map(line).join('\n');
  return out.slice(0, INDEX_CAP);
}

function buildSystemMessages(root, profile = {}) {
  let sys = RULES;
  if (profile.name) sys += `\n- اسم صاحب مساحة العمل: ${profile.name} — خاطبه به عند الاقتضاء.`;

  // KUNNASH.md: تعليمات المستخدم الدائمة لمساحته — تعلو على أسلوبنا الافتراضي
  const kunnashMd = path.join(root, 'KUNNASH.md');
  if (fs.existsSync(kunnashMd)) {
    const custom = fs.readFileSync(kunnashMd, 'utf8').slice(0, 8000);
    sys += `\n\nتعليمات صاحب مساحة العمل (من KUNNASH.md — التزمها):\n${custom}`;
  }

  const index = buildIndex(root);
  if (index) sys += `\n\n${index}`;

  return [{ role: 'system', content: sys }];
}

/**
 * تشغيل كامل: يحمّل النص، يلحق رسالة المستخدم، يشغّل الحلقة، يحفظ.
 * @returns {{ text, usage, stopReason }}
 */
async function runAgent({
  cfg, root, sessionId,
  userContent,                       // نص أو مصفوفة أجزاء (مرفقات)
  seedMessages,                      // تاريخ جلسة سبقت وجود النص المحفوظ
  profile,
  onDelta, onTool, onPermission,
  signal,
  limits,
}) {
  const systemMessages = buildSystemMessages(root, profile);
  const loaded = transcript.load(root, sessionId) || seedMessages || [];
  const messages = transcript.prune(loaded);
  messages.push({ role: 'user', content: userContent });

  // حلقة متداخلة للعملاء: ترث الميزانية والبوابة والإلغاء، وترجع النص فقط.
  // بلا runNested في سياقها — فالعمق محصور بمستوى واحد بنيويًا.
  const budget = { calls: 0, tokens: 0, cost: 0, start: Date.now() };
  const ctx = {
    root,
    runNested: async ({ agentBody, task }) => {
      const res = await runLoop({
        cfg,
        systemMessages: [
          { role: 'system', content: `${RULES}\n\nأنت الآن تعمل بدور هذا العميل والتزم قواعده:\n${agentBody}` },
        ],
        messages: [{ role: 'user', content: task }],
        ctx: { root },                  // بلا runNested — لا تداخل أعمق
        onDelta: null,                  // النص النهائي فقط يرجع للأم
        onTool,
        onPermission,
        signal,
        limits,
        budget,                         // ميزانية مشتركة لا منفصلة
      });
      return res.text || '(العميل لم يرجع نصًا)';
    },
  };

  const result = await runLoop({
    cfg, systemMessages, messages, ctx,
    onDelta, onTool, onPermission, signal, limits, budget,
  });

  transcript.save(root, sessionId, messages);
  return result;
}

module.exports = { runAgent, buildSystemMessages, RULES };
