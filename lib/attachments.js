// مرفقات المحادثة → أجزاء محتوى OpenAI-compatible.
//
// النموذج اليوم بلا وصول للملفات، فما يُرفق يُضمَّن في الرسالة نصًا أو صورة.
// وحلقة الأدوات (م٣) تقرأ ما **في مساحة العمل**؛ أما المرفق فقد يأتي من أي
// مكان في الجهاز — فيبقى هذا المسار طريقه، ويخدم كذلك النماذج بلا أدوات.
//
// وما يُقرأ وما يُرفض ليس قرار هذا الملف: الجدول في lib/filetypes.js يخدم
// هذا الطريق وطريق الأدوات معًا، فلا يفترقان كما افترقا من قبل.

const fs = require('fs');
const path = require('path');

const { xlsxToCsv, docxToText } = require('./agent/office');
const { kindOf, imageMime, refusal } = require('./filetypes');

const MAX_TEXT = 60000;                    // حد النص المضمّن لكل ملف
const MAX_IMG_BYTES = 10 * 1024 * 1024;

/** يقصّ عند الحد ويُعلن القصّ — نصٌّ ناقصٌ بصمت أسوأ من نصٍّ يقول إنه نقص */
function cap(text) {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n… (اقتُطع)' : text;
}

function buildMessageParts(paths) {
  const parts = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    const name = path.basename(abs);
    const kind = kindOf(abs);

    if (kind === 'image') {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_IMG_BYTES) throw new Error(`الصورة «${name}» أكبر من 10MB — صغّرها ثم أرفقها.`);
      const b64 = fs.readFileSync(abs).toString('base64');
      parts.push({ type: 'image_url', image_url: { url: `data:${imageMime(abs)};base64,${b64}` } });
    } else if (kind === 'text') {
      parts.push({ type: 'text', text: `محتوى الملف المرفق «${name}»:\n${cap(fs.readFileSync(abs, 'utf8'))}` });
    } else if (kind === 'sheet' || kind === 'doc') {
      parts.push({ type: 'text', text: readOffice(abs, kind, name) });
    } else {
      // الاسم والسبب والمخرج — لا «غير مدعوم» وحدها تترك صاحبها واقفًا
      throw new Error(refusal(abs));
    }
  }
  return parts;
}

/** xlsx → CSV لكل ورقة · docx → نصّ */
function readOffice(abs, kind, name) {
  try {
    if (kind === 'sheet') {
      const body = xlsxToCsv(abs).map((s) => `=== ورقة: ${s.name} ===\n${s.csv}`).join('\n\n');
      return `محتوى الجدول المرفق «${name}» (CSV لكل ورقة):\n${cap(body)}`;
    }
    return `محتوى المستند المرفق «${name}»:\n${cap(docxToText(abs))}`;
  } catch (err) {
    // سبب العطب يُنقل كما هو: «ورقة معلنة بلا محتوى» تدلّ، و«تعذّرت القراءة» لا
    throw new Error(`تعذّرت قراءة «${name}»: ${String(err && err.message || err)}`);
  }
}

module.exports = { buildMessageParts };
