// مرفقات المحادثة → أجزاء محتوى OpenAI-compatible.
//
// النموذج اليوم بلا وصول للملفات، فما يُرفق يُضمَّن في الرسالة نصًا أو صورة.
// وحلقة الأدوات (م٣) تقرأ ما **في مساحة العمل**؛ أما المرفق فقد يأتي من أي
// مكان في الجهاز — فيبقى هذا المسار هو طريقه، ويخدم كذلك النماذج بلا أدوات.

const fs = require('fs');
const path = require('path');

const { xlsxToCsv, docxToText } = require('./agent/office');

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml']);
const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};
// ما زال بلا مفكّك: PDF وpptx وxls القديمة (صيغة ثنائية أخرى قبل 2007).
const DEFERRED_EXTS = new Set(['.pdf', '.pptx', '.xls']);

const MAX_TEXT = 60000;                    // حد النص المضمّن لكل ملف
const MAX_IMG_BYTES = 10 * 1024 * 1024;

/** يقصّ عند الحد ويُعلن القصّ — نصٌّ ناقصٌ بصمت أسوأ من نصٍّ يقول إنه نقص */
function cap(text) {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n… (اقتُطع)' : text;
}

/** xlsx → CSV لكل ورقة · docx → نصّ */
function readOffice(abs, ext, name) {
  try {
    if (ext === '.xlsx') {
      const sheets = xlsxToCsv(abs);
      const body = sheets.map((s) => `=== ورقة: ${s.name} ===\n${s.csv}`).join('\n\n');
      return `محتوى الجدول المرفق «${name}» (CSV لكل ورقة):\n${cap(body)}`;
    }
    return `محتوى المستند المرفق «${name}»:\n${cap(docxToText(abs))}`;
  } catch (err) {
    // سبب العطب يُنقل كما هو: «ورقة معلنة بلا محتوى» تدلّ، و«تعذّرت القراءة» لا
    throw new Error(`تعذّرت قراءة «${name}»: ${String(err && err.message || err)}`);
  }
}

function buildMessageParts(paths) {
  const parts = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    const name = path.basename(abs);
    const ext = path.extname(abs).toLowerCase();

    if (IMG_MIME[ext]) {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_IMG_BYTES) throw new Error(`الصورة «${name}» أكبر من 10MB — صغّرها ثم أرفقها.`);
      const b64 = fs.readFileSync(abs).toString('base64');
      parts.push({ type: 'image_url', image_url: { url: `data:${IMG_MIME[ext]};base64,${b64}` } });
    } else if (TEXT_EXTS.has(ext)) {
      let out = fs.readFileSync(abs, 'utf8');
      if (out.length > MAX_TEXT) out = out.slice(0, MAX_TEXT) + '\n… (اقتُطع)';
      parts.push({ type: 'text', text: `محتوى الملف المرفق «${name}»:\n${out}` });
    } else if (ext === '.xlsx' || ext === '.docx') {
      // كانت هذه ترمي «لم تُبنَ بعد» — وهي **ملاحظةٌ بائتة من م٢**: المفكّك
      // بُني في م٣ (read_excel/read_document) ووُصل بالأدوات وحدها، فبقي باب
      // المرفقات مغلقًا على مفكّكٍ يعمل. من أرفق جدوله رأى «لا يقرأ الملفات»
      // والحقيقة أن الطريق لم يُوصَل لا أن القراءة عاجزة.
      parts.push({ type: 'text', text: readOffice(abs, ext, name) });
    } else if (DEFERRED_EXTS.has(ext)) {
      throw new Error(`قراءة «${name}» لم تُبنَ بعد — صدّره CSV أو نصًا وأرفقه.`);
    } else {
      throw new Error(`نوع الملف «${name}» غير مدعوم — المدعوم: الصور والملفات النصية وCSV.`);
    }
  }
  return parts;
}

module.exports = { buildMessageParts };
