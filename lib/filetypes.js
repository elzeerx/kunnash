// ما يقرؤه كُنّاش — **جدولٌ واحد** يخدم الطريقين.
//
// الطريقان: ما تُرفقه في المحادثة (attachments.js)، وما يقرؤه العميل من
// مساحة عملك (agent/tools.js). وكانا يفترقان: بُني مفكّك xlsx في م٣ ووُصل
// بالأدوات وحدها، فبقي المرفق يرمي «لم تُبنَ بعد» على قدرةٍ حاضرة. وطريقان
// يقرران الدعم كلٌّ على حدة سيفترقان ثانيةً — فالقرار هنا وحده.
//
// وقاعدة العائلات: **ما لا نفهمه لا نقرؤه بايتاتٍ خامًا**. قراءة xlsx بـutf8
// تُخرج آلاف المحارف المشوّهة (PK♦…) — وهي أسوأ من خطأ: تُنفق رموز المستخدم
// وتُضلّل النموذج بضجيجٍ يظنه محتوى.

const path = require('path');

const TEXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.html', '.htm',
  '.xml', '.yaml', '.yml', '.log', '.ini', '.conf', '.toml', '.srt', '.vtt',
  // شيفرة — تُقرأ نصًّا كسائر النصّ
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.py', '.rb',
  '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.php', '.sh',
  '.sql', '.env', '.gitignore',
]);

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

const SHEET = new Set(['.xlsx']);
const DOC = new Set(['.docx']);

// ما لا مفكّك له بعد — يُرفض **بالاسم وبمخرجٍ مقترح**، ولا يُقرأ خامًا.
// وكلٌّ يحمل بديله: القول «غير مدعوم» بلا مخرج يترك المستخدم واقفًا.
const UNSUPPORTED = {
  '.pdf': 'صدّره نصًّا أو Word ثم أرفقه',
  '.pptx': 'صدّر الشرائح PDF ثم نصًّا، أو انسخ نصّها',
  '.xls': 'افتحه في Excel واحفظه بصيغة xlsx',
  '.doc': 'افتحه في Word واحفظه بصيغة docx',
  '.pages': 'صدّره Word (docx) من Pages',
  '.numbers': 'صدّره Excel (xlsx) من Numbers',
  '.key': 'صدّره PDF من Keynote',
  '.heic': 'حوّله PNG أو JPEG (المعاينة ← تصدير)',
  '.mov': 'الفيديو لا يُقرأ — أرفق لقطةً منه أو نصَّه',
  '.mp4': 'الفيديو لا يُقرأ — أرفق لقطةً منه أو نصَّه',
  '.zip': 'فُكّ الأرشيف وأرفق ما بداخله',
};

/**
 * تصنيف ملف بامتداده.
 * @returns {'text'|'image'|'sheet'|'doc'|'unsupported'|'unknown'}
 */
function kindOf(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (IMAGE_MIME[ext]) return 'image';
  if (SHEET.has(ext)) return 'sheet';
  if (DOC.has(ext)) return 'doc';
  if (TEXT.has(ext)) return 'text';
  if (UNSUPPORTED[ext]) return 'unsupported';
  return 'unknown';
}

function imageMime(filePath) {
  return IMAGE_MIME[path.extname(String(filePath)).toLowerCase()] || null;
}

/** رسالة رفضٍ تحمل الاسم والسبب والمخرج — لا «غير مدعوم» وحدها */
function refusal(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  const name = path.basename(String(filePath));
  const way = UNSUPPORTED[ext];
  if (way) return `«${name}»: صيغة ${ext} لا تُقرأ بعد — ${way}.`;
  return `«${name}»: صيغة ${ext || 'بلا امتداد'} غير معروفة. المدعوم: النصوص والشيفرة وCSV وxlsx وdocx والصور.`;
}

/** لمرشّح نافذة الاختيار — ما يُعرض على المستخدم هو ما يُقبل فعلًا */
function pickerExtensions() {
  return [...TEXT, ...Object.keys(IMAGE_MIME), ...SHEET, ...DOC]
    .map((e) => e.slice(1))
    .sort();
}

module.exports = { kindOf, imageMime, refusal, pickerExtensions, TEXT, IMAGE_MIME, SHEET, DOC, UNSUPPORTED };
