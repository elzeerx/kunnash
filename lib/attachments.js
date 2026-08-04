// مرفقات المحادثة → أجزاء محتوى OpenAI-compatible.
//
// النموذج اليوم بلا وصول للملفات، فما يُرفق يُضمَّن في الرسالة نصًا أو صورة.
// حين تدخل حلقة الأدوات (م٣) يصير للمرفق مسار يقرأه النموذج بنفسه، ويبقى هذا
// المسار قائمًا للنماذج التي لا تستعمل أدوات.

const fs = require('fs');
const path = require('path');

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml']);
const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};
// جداول ومستندات ثنائية: تحتاج مفكّكًا خاصًا، ويدخل مع أدوات م٣
// (read_excel / read_document) بقرار تبعية واحد يخدم المسارين معًا.
const DEFERRED_EXTS = new Set(['.xlsx', '.xls', '.docx', '.pdf', '.pptx']);

const MAX_TEXT = 60000;                    // حد النص المضمّن لكل ملف
const MAX_IMG_BYTES = 10 * 1024 * 1024;

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
    } else if (DEFERRED_EXTS.has(ext)) {
      throw new Error(`قراءة «${name}» لم تُبنَ بعد — صدّره CSV أو نصًا وأرفقه.`);
    } else {
      throw new Error(`نوع الملف «${name}» غير مدعوم — المدعوم: الصور والملفات النصية وCSV.`);
    }
  }
  return parts;
}

module.exports = { buildMessageParts };
