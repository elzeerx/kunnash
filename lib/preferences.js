// تفضيلات مساحة العمل — ذاكرة كُنّاش عن صاحبه.
//
// الفكرة: بدل أن يسأل التطبيق نفس السؤال كل مرة («بأي صيغة تريد الملف؟»)،
// يسأل مرة ويحفظ الجواب إن أذن صاحبه — فتتراكم معرفةٌ تختصر المحادثات
// اللاحقة. وتُحقن في رسالة النظام فيلتزمها النموذج بلا سؤال.
//
// شرطان يحفظان الثقة:
//   ١. لا يُحفظ شيء إلا باختيار صريح من المستخدم في مربع السؤال.
//   ٢. ما يُحفظ يُعرض في الإعدادات ويُحذف بنقرة — ذاكرة لا تُرى ولا تُمحى
//      تُقلق أكثر مما تنفع.
//
// المكان: <مساحة العمل>/.kunnash/preferences.json — تخص المجلد لا الجهاز،
// فمساحة عمل الجمعية غير مساحة العمل الشخصية.

const fs = require('fs');
const path = require('path');

const MAX_KEY = 60;
const MAX_VALUE = 400;
const MAX_ENTRIES = 40;

function file(root) { return path.join(root, '.kunnash', 'preferences.json'); }

function load(root) {
  try {
    const data = JSON.parse(fs.readFileSync(file(root), 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

function save(root, items) {
  const f = file(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ items }, null, 1), 'utf8');
}

/** يضيف تفضيلًا أو يحدّث الموجود بنفس المفتاح */
function remember(root, key, value) {
  const k = String(key || '').trim().slice(0, MAX_KEY);
  const v = String(value || '').trim().slice(0, MAX_VALUE);
  if (!k || !v) throw new Error('التفضيل يحتاج مفتاحًا وقيمة.');

  const items = load(root).filter((i) => i.key !== k);
  items.push({ key: k, value: v, at: Date.now() });
  // سقف يمنع التضخم: الأقدم يسقط أولًا
  save(root, items.slice(-MAX_ENTRIES));
  return { key: k, value: v };
}

function forget(root, key) {
  const items = load(root);
  const kept = items.filter((i) => i.key !== key);
  if (kept.length === items.length) return false;
  save(root, kept);
  return true;
}

/** سطور مضغوطة لرسالة النظام — والسقف يحمي التخزين المؤقت من التضخم */
function promptBlock(root) {
  const items = load(root);
  if (!items.length) return '';
  const lines = items.map((i) => `- ${i.key}: ${i.value}`).join('\n');
  return `تفضيلات صاحب مساحة العمل (حفظها بنفسه — التزمها ولا تسأل عنها ثانية):\n${lines}`.slice(0, 2000);
}

module.exports = { load, remember, forget, promptBlock };
