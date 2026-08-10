// حارس المسار الموحّد — النقطة الوحيدة التي تقرر: هل هذا المسار داخل مساحة العمل؟
//
// كل ما يمسّ ملفًا يمرّ من هنا: فتح ملف من الواجهة، والمكتبة، وكل أداة ملفات
// في حلقة م٣. الحارس واحد لأن تكرار المنطق يعني اختلافه، واختلافه يعني ثغرة.
//
// لماذا realpath ضروري لا تجميلي:
//   على الماك يكون الجذر نفسه خلف رابط رمزي كثيرًا (/tmp ← /private/tmp،
//   و/var ← /private/var). ومقارنةُ جذرٍ غير محلول بمرشحٍ محلول تُنتج خطأين
//   معًا لا واحدًا: رفضًا كاذبًا لمسار داخل المجلد فعلًا، وقبولًا كاذبًا لمسار
//   خارجه. فنحلّ الطرفين قبل المقارنة، دائمًا.
//
// ولماذا «البادئة الموجودة» لا المسار كاملًا:
//   لا يمكن realpath لملف على وشك الإنشاء — يرمي ENOENT. فنصعد حتى أول مكوّن
//   موجود، نحلّه، ثم نعيد إلحاق الذيل. هذا الموضع بالذات هو ما تسقط فيه
//   الحراس الساذجة: تعمل عند القراءة وتنهار عند الكتابة.

const fs = require('fs');
const path = require('path');

// مجلد شيفرة التطبيق — نموذج يعدّل التطبيق الذي يشغّله تعديلٌ ذاتي، لا مهمة
const APP_DIR = path.resolve(__dirname, '..');

class PathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PathError';
    this.code = code;
  }
}

// ---------- تحليل الجذر ----------
// يُحلّ مرة ويُحفظ: الجذر لا يتبدّل إلا بتبديل مساحة العمل
const rootCache = new Map();

function resolveRoot(root) {
  if (typeof root !== 'string' || !root) {
    throw new PathError('BAD_ROOT', 'لم تُحدَّد مساحة عمل.');
  }
  const cached = rootCache.get(root);
  if (cached) return cached;
  let real;
  try {
    real = fs.realpathSync(root);
  } catch {
    throw new PathError('BAD_ROOT', `مجلد العمل غير موجود: ${root}`);
  }
  rootCache.set(root, real);
  return real;
}

function forgetRoot(root) {
  if (root === undefined) rootCache.clear();
  else rootCache.delete(root);
}

// ---------- تحليل المرشّح ----------
// يصعد حتى أول مكوّن موجود، يحلّه، ثم يعيد إلحاق ما تحته
function realpathExistingPrefix(candidate) {
  const tail = [];
  let cur = candidate;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (err) {
      // ENOENT: لم يُنشأ بعد · ENOTDIR: مكوّن في الطريق ملفٌ لا مجلد
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
        if (err.code === 'ELOOP') throw new PathError('DENIED', 'المسار يدور على نفسه بروابط رمزية.');
        throw new PathError('DENIED', `تعذّر تحليل المسار: ${err.code || err.message}`);
      }
      const parent = path.dirname(cur);
      if (parent === cur) return candidate;   // بلغنا جذر النظام ولا شيء موجود
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

// ---------- منع الكتابة ----------
// تُطبَّق **بعد** الاحتواء: هذه مواضع داخل مساحة العمل ومع ذلك ممنوعة
function writeDenyReason(realRoot, abs, rel) {
  const segments = rel.split(path.sep);

  if (segments[0] === '.kunnash') return 'هذا مخزن كُنّاش نفسه — لا يُكتب فيه مباشرة.';
  if (segments.includes('.git')) return 'مجلد git لا يُكتب فيه.';
  if (segments[0] === '.claude') return 'مجلد ‎.claude‎ يخص أداة أخرى — كُنّاش يقرأ منه ولا يكتب فيه.';
  if (segments.some((s) => s.toLowerCase().endsWith('.app'))) return 'حزم التطبيقات لا تُعدَّل.';

  // شيفرة كُنّاش نفسها — يقع هذا حين تكون مساحة العمل هي مجلد المشروع
  const fromApp = path.relative(APP_DIR, abs);
  if (fromApp === '' || (!fromApp.startsWith('..') && !path.isAbsolute(fromApp))) {
    return 'هذا ملف من شيفرة كُنّاش — لا يعدّل التطبيق نفسه.';
  }
  return null;
}

/**
 * يحلّ مسارًا داخل مساحة العمل أو يرمي.
 *
 * @param {string} root       مساحة العمل (قد تكون خلف رابط رمزي)
 * @param {string} input      مسار نسبي أو مطلق
 * @param {object} [opts]
 * @param {boolean} [opts.mustExist=false]  يرمي NOT_FOUND إن لم يوجد
 * @param {boolean} [opts.forWrite=false]   يطبّق قائمة المنع
 * @returns {{ abs: string, rel: string }}  rel نسبي للجذر، و'' يعني الجذر نفسه
 */
function resolveInWorkspace(root, input, opts = {}) {
  const { mustExist = false, forWrite = false } = opts;

  if (typeof input !== 'string') throw new PathError('BAD_INPUT', 'المسار يجب أن يكون نصًا.');
  if (!input.trim()) throw new PathError('BAD_INPUT', 'المسار فارغ.');
  if (input.includes('\0')) throw new PathError('BAD_INPUT', 'المسار يحوي بايتًا صفريًا.');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) || /^(data|javascript|file):/i.test(input)) {
    throw new PathError('BAD_INPUT', 'هذا رابط لا مسار ملف.');
  }

  const realRoot = resolveRoot(root);
  // path.resolve يطبّع «..» قبل أي لمس للقرص، فلا يصل اجتياز إلى realpath أصلًا
  const candidate = path.resolve(realRoot, input);
  const abs = realpathExistingPrefix(candidate);

  // الاحتواء بـ relative لا بـ startsWith: أدق عند تشابه أسماء المجلدات
  // (‎/Work‎ مقابل ‎/Work-2‎)، ويستفيد من تطبيع realpath لحالة الأحرف على APFS
  const rel = path.relative(realRoot, abs);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new PathError('OUTSIDE_WORKSPACE', 'هذا المسار خارج مجلد العمل.');
  }

  if (forWrite) {
    const reason = writeDenyReason(realRoot, abs, rel);
    if (reason) throw new PathError('DENIED', reason);
  }

  if (mustExist && !fs.existsSync(abs)) {
    throw new PathError('NOT_FOUND', `لا يوجد ملف بهذا المسار: ${rel}`);
  }

  // المسار النسبي يخرج بفاصل «/» دائمًا مهما كان النظام.
  // لأنه ليس مسار نظامٍ يُفتح به ملف — بل **قيمة تُعرض وتُطابَق**: تظهر
  // للمستخدم، وتُقارن بأنماط glob، وتُحفظ في قواعد الأذونات، وتُرسل إلى
  // النموذج. فلو خرجت بـ«\» على ويندوز لانكسر كل ذلك، ولاختلفت قاعدة إذنٍ
  // حُفظت على نظام عن نظيرتها على آخر. والفتح يبقى بـabs بفاصل نظامه.
  return { abs, rel: rel.split(path.sep).join('/') };
}

// كتابة مقسّاة: O_NOFOLLOW يمنع سباقًا يستبدل الهدف برابط رمزي بين الفحص
// والفتح. الحارس وحده يكشف الروابط القائمة، وهذا يكشف ما يُصنع بعده.
function writeFileGuarded(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
  let fd;
  try {
    fd = fs.openSync(abs, flags, 0o644);
  } catch (err) {
    if (err.code === 'ELOOP') throw new PathError('DENIED', 'الهدف رابط رمزي — لا يُكتب عبره.');
    throw err;
  }
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { resolveInWorkspace, writeFileGuarded, forgetRoot, PathError, APP_DIR };
