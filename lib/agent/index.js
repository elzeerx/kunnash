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
const prefs = require('../preferences');
const skills = require('./skills');

const RULES = `أنت كُنّاش — مكتب عمل شخصي ينفّذ مهام المستخدم داخل مجلد عمله عبر الأدوات.
القواعد:
- اعمل على الملفات بالأدوات وبمسارات نسبية من جذر مساحة العمل. لا تخمّن محتوى ملف — اقرأه.
- **أين يذهب المخرَج:** ما يقرؤه المستخدم أو ينسخه (ردّ بريد، رسالة، فقرة، جدول قصير، شيفرة) **يبقى في المحادثة ولا تُنشئ له ملفًا**. ضع النص القابل للنسخ وحده داخل كتلة اقتباس بادئتها «> » لكل سطر (للرسائل والمسودات) أو كتلة شيفرة مسوّرة بثلاث علامات باكتيك (للشيفرة والبيانات) — بلا شرحك داخلها، ويكون شرحك خارجها.
- لا تُنشئ ملفًا إلا إذا طلبه المستخدم صراحةً، أو كان المخرَج مستندًا طويلًا منسّقًا (تقرير، عرض، مستند للطباعة أو للإرسال كملف).
- إن لزم ملف ولم يحدد المستخدم صيغته ولا تجد تفضيلًا محفوظًا أدناه: اسأله بـask_user بخيارات مثل «Word (docx)» و«صفحة HTML» و«ماركداون (md)» و«اتركه في المحادثة»، ومرّر remember_key:"صيغة المخرجات" ليحفظ اختياره إن شاء. لا تسأل أكثر من سؤال واحد في التشغيل الواحد.
- احفظ الملفات في مجلد «المخرجات/» ما لم يحدد غيره، واذكر مسار كل ملف أنشأته داخل علامتي باكتيك مثل \`المخرجات/تقرير.docx\` ليصير رابطًا قابلًا للنقر.
- نسّق ردك: عناوين قصيرة، وقوائم حين تُعدّد، وجداول حين تقارن. لا تُغرق ردًا قصيرًا بعناوين.
- سلّم مسودة يكملها الإنسان: لا ترسل بريدًا ولا تعتمد شيئًا نيابة عن أحد.
- المهام المركّبة: دوّن خطتك بـtodo_write وحدّثها مع التقدم.
- قبل تنفيذ مهمة لها مهارة مطابقة في الفهرس أدناه: اقرأها بـread_skill والتزم خطواتها.
- إن طلب المستخدم إنشاء مهارة أو عميل أو تعديلهما فاستعمل save_skill (لا write_file) — مكتبته محمية ولا تُكتب مباشرة.
- لا تخترع أرقامًا ولا مصادر، ولا تدّعِ إنجاز ما لم تفعله.
- **لغة ردك من لغة سؤاله لا من لغة الواجهة**: من كتب بالعربية يُجاب بالعربية الفصحى، ومن كتب بالإنجليزية يُجاب بالإنجليزية — إلا أن يطلب غير ذلك صراحةً. ولو كانت واجهة التطبيق بلغة أخرى فهي تخصّ أزراره لا حديثك معه.`;

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

  // التفضيلات المحفوظة تعلو على السؤال: ما حُفظ لا يُسأل عنه ثانية
  const saved = prefs.promptBlock(root);
  if (saved) sys += `\n\n${saved}`;

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
  forceSkillId,                      // تفعيل يدوي من قائمة الواجهة
  onDelta, onTool, onPermission, askUser, onSkillInjected,
  signal,
  limits,
}) {
  const systemMessages = buildSystemMessages(root, profile);

  // حقن المهارة: تفعيل يدوي يفرضها، وإلا فالمحفّز الحتمي. وتُثبَّت في الموضع
  // الثاني دائمًا — شرط بقاء بادئة الطلب متطابقة عبر الجولات.
  let injectedSkill = null;
  const asText = typeof userContent === 'string'
    ? userContent
    : (userContent || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
  try {
    if (forceSkillId) {
      systemMessages.push(skills.skillMessage(root, forceSkillId));
      injectedSkill = forceSkillId;
    } else {
      const hit = skills.matchSkill(root, asText);
      if (hit) {
        systemMessages.push(skills.skillMessage(root, hit.skill.id));
        injectedSkill = hit.skill.id;
      }
    }
  } catch { /* مهارة محذوفة أو تالفة — نكمل بلا حقن */ }
  if (injectedSkill && onSkillInjected) onSkillInjected(injectedSkill);

  const loaded = transcript.load(root, sessionId) || seedMessages || [];
  const messages = transcript.prune(loaded);
  messages.push({ role: 'user', content: userContent });

  // حلقة متداخلة للعملاء: ترث الميزانية والبوابة والإلغاء، وترجع النص فقط.
  // بلا runNested في سياقها — فالعمق محصور بمستوى واحد بنيويًا.
  const budget = { calls: 0, tokens: 0, cost: 0, start: Date.now() };
  const ctx = {
    root,
    askUser,
    runNested: async ({ agentBody, task }) => {
      const res = await runLoop({
        cfg,
        systemMessages: [
          { role: 'system', content: `${RULES}\n\nأنت الآن تعمل بدور هذا العميل والتزم قواعده:\n${agentBody}` },
        ],
        messages: [{ role: 'user', content: task }],
        ctx: { root },                  // بلا runNested ولا askUser — لا تداخل ولا مقاطعة
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
  return { ...result, injectedSkill };
}

module.exports = { runAgent, buildSystemMessages, RULES };
