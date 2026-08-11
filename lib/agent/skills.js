// حقن المهارات — فهرس مضغوط + محفّز حتمي، لا اعتماد على ذكاء النموذج.
//
// الأرقام تحسم (§٧): من مساحة عمل حقيقية — ٥ مهارات بـ٢٤.٥ كيلوبايت ≈ ١٠–١٦
// ألف رمز، وأوصافها المختصرة ≈ ٦٠٠–٩٠٠ رمز. النسبة ١:١٥ هي كامل الحجة ضد
// حقن الكل في برومبت النظام.
//
// فالمعتمد: فهرسٌ مضغوط + أداتا list_skills/read_skill (وهما مبنيتان في م٣)
// + **شبكة أمان حتمية** هنا: مطابقٌ خفيف يقارن رسالة المستخدم بعبارات
// التفعيل المستخرجة من الأوصاف. تطابقٌ واحد قوي ← تُحقن تلك المهارة وحدها
// قبل أول طلب، بلا جولة زائدة وبلا رهان على أن النموذج سيستدعيها.
// تطابقان أو أكثر ← لا حقن، يختار بنفسه (فالترجيح بيننا خطأ محتمل).
//
// لماذا لا نتركها للنموذج وحده: النماذج الضعيفة لا تستدعي read_skill فتُهمَل
// المهارة **بصمت** — وهذا أسوأ من غلاء الرموز، لأن المستخدم لا يعلم أنها
// أُهملت أصلًا.

const library = require('../library');

// ---------- تطبيع عربي ----------
// المستخدم يكتب «الأسبوع» و«الاسبوع»، و«ملخّص» و«ملخص» — والمطابقة الحرفية
// تسقط بينهما. وانتقل المنطق إلى `lib/arabic.js` لأن `search_files` يحتاجه
// كذلك: قاعدة «متى يكون نصّان نفس الكلمة» لا تُكتب مرتين في تطبيق عربي.
const { normalize } = require('../arabic');

/**
 * عبارات التفعيل: ما بين «...» أو "..." في الوصف — وهي ما يكتبه صاحب المهارة
 * عمدًا كأمثلة نداء — ثم اسم المهارة ومعرّفها.
 * تُقبل العبارة إن كانت كلمتين فأكثر: الكلمة الواحدة تطابق بالصدفة.
 */
function triggersOf(skill) {
  const out = new Set();
  const desc = String(skill.description || '');
  for (const m of desc.matchAll(/[«"]([^«»"]{3,80})[»"]/g)) {
    const t = normalize(m[1]);
    if (t.split(' ').length >= 2) out.add(t);
  }
  for (const label of [skill.name, skill.id]) {
    const t = normalize(label);
    if (t && t.split(' ').length >= 2) out.add(t);
    // معرّف بشرطات: «تقرير-الأسبوع» ← «تقرير الأسبوع»
    const dashed = normalize(String(label || '').replace(/[-_]/g, ' '));
    if (dashed && dashed.split(' ').length >= 2) out.add(dashed);
  }
  return [...out];
}

// المطابقة الحرفية (`text.includes`) تسقط عند أدنى تغيير في الصياغة:
// «اكتب **لي** ردًّا» لا تطابق «اكتب ردًّا» — وهذا يجعل المحفّز بلا فائدة
// عمليًا، لأن أحدًا لا ينسخ عبارة التفعيل حرفًا بحرف.
//
// فالمطابقة **متتالية مرتّبة بفجوة محدودة**: كل كلمات العبارة تظهر في نص
// المستخدم بالترتيب نفسه، ولا تفصل بين متجاورتين أكثر من كلمتين. فالحشو
// الطبيعي («لي»، «من فضلك») يمرّ، والتقارب البعيد بالصدفة لا يمرّ.
const MAX_GAP = 2;

function matchesTrigger(textTokens, triggerTokens) {
  let from = 0;
  for (let i = 0; i < triggerTokens.length; i++) {
    const at = textTokens.indexOf(triggerTokens[i], from);
    if (at < 0) return false;
    if (i > 0 && at - from > MAX_GAP) return false;   // تباعدت الكلمات
    from = at + 1;
  }
  return true;
}

/**
 * @returns {{ skill, trigger } | null} تطابقٌ واحد قوي، وإلا null
 */
function matchSkill(root, userText) {
  const text = normalize(userText);
  if (!text) return null;
  const textTokens = text.split(' ');

  let skills;
  try { skills = library.listLibrary(root).skills; } catch { return null; }

  const hits = [];
  for (const s of skills) {
    const trigger = triggersOf(s).find((t) => matchesTrigger(textTokens, t.split(' ')));
    if (trigger) hits.push({ skill: s, trigger });
  }
  // تطابقان فأكثر: لا نرجّح بينهما — النموذج يختار بأداتيه
  return hits.length === 1 ? hits[0] : null;
}

/**
 * نص المهارة كرسالة نظام ثانية.
 * تُثبَّت في الموضع الثاني دائمًا ولا تُزال أثناء التشغيل — شرطُ بقاء بادئة
 * الطلب متطابقة بايتًا ببايت عبر الجولات (التخزين المؤقت، §٩).
 */
function skillMessage(root, id) {
  const body = library.readItem(root, 'skill', id);
  return {
    role: 'system',
    content: `المهارة المفعّلة لهذا الطلب — اتبع خطواتها حرفيًا:\n\n${body}`,
  };
}

module.exports = { matchSkill, triggersOf, normalize, skillMessage, matchesTrigger };
