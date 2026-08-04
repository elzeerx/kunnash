// معالجة مرفقات المحادثة — مساران:
//   stageAttachments  : ينسخ الملف داخل مساحة العمل ويرجع مساره النسبي، ليقرأه
//                       العميل بأدواته (تستهلكه حلقة الأدوات في م٣).
//   buildProviderParts: يحوّل المحتوى لنص مضمّن أو صورة base64، للنماذج التي
//                       لا وصول لها للملفات — وهو المسار الوحيد العامل اليوم.

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.yaml', '.yml']);
const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};
const MAX_TEXT = 60000;          // حد النص المضمّن لكل ملف
const MAX_IMG_BYTES = 10 * 1024 * 1024;

// يرجع مسارات نسبية داخل مساحة العمل (ينسخ ما كان خارجها إلى .kunnash/attachments/<تاريخ>/)
function stageAttachments(root, paths) {
  const rels = [];
  for (const p of paths) {
    let abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`الملف غير موجود: ${path.basename(p)}`);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      const day = new Date().toISOString().slice(0, 10);
      const destDir = path.join(root, '.kunnash', 'attachments', day);
      fs.mkdirSync(destDir, { recursive: true });
      const ext = path.extname(abs);
      const base = path.basename(abs, ext);
      let target = path.join(destDir, base + ext);
      let i = 1;
      while (fs.existsSync(target)) target = path.join(destDir, `${base}-${i++}${ext}`);
      fs.copyFileSync(abs, target);
      abs = target;
    }
    rels.push(path.relative(root, abs));
  }
  return rels;
}

// للنماذج الخارجية: يحوّل الملفات لأجزاء محتوى OpenAI-compatible
function buildProviderParts(paths) {
  const parts = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    const name = path.basename(abs);
    const ext = path.extname(abs).toLowerCase();

    if (IMG_MIME[ext]) {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_IMG_BYTES) throw new Error(`الصورة «${name}» أكبر من 10MB — صغّرها أو استخدم مرفقًا نصيًا بدلها.`);
      const b64 = fs.readFileSync(abs).toString('base64');
      parts.push({ type: 'image_url', image_url: { url: `data:${IMG_MIME[ext]};base64,${b64}` } });
    } else if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.readFile(abs);
      let out = '';
      for (const n of wb.SheetNames) {
        out += `=== ورقة: ${n} ===\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false }) + '\n';
      }
      if (out.length > MAX_TEXT) out = out.slice(0, MAX_TEXT) + '\n… (اقتُطع)';
      parts.push({ type: 'text', text: `محتوى الملف المرفق «${name}»:\n${out}` });
    } else if (TEXT_EXTS.has(ext)) {
      let out = fs.readFileSync(abs, 'utf8');
      if (out.length > MAX_TEXT) out = out.slice(0, MAX_TEXT) + '\n… (اقتُطع)';
      parts.push({ type: 'text', text: `محتوى الملف المرفق «${name}»:\n${out}` });
    } else {
      throw new Error(`نوع الملف «${name}» غير مدعوم مع النماذج الخارجية (المدعوم: صور، Excel، ملفات نصية) — حوّله لنص أو صورة.`);
    }
  }
  return parts;
}

module.exports = { stageAttachments, buildProviderParts };
