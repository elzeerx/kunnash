// فحص الإصدار — سؤالٌ واحد يوميًا: هل من أحدث؟
//
// **فحصٌ لا تحديث.** لا يُنزّل شيئًا ولا يستبدل التطبيق نفسه — يخبر فقط،
// والتحميل بيد صاحبه. لأن تطبيقًا يستبدل نفسه على جهازك بلا نظرك يناقض
// «كل شيء بإذنك»، ولأن التحديث التلقائي يحتاج خادمًا ولا خادم لنا.
//
// ولماذا مفعَّلٌ افتراضيًا: من حمّل نسخةً فيها عيبٌ أُصلح لا يعلم أنه أُصلح،
// وتطبيقٌ يقرأ ملفاتك ويكتب فيها يجب أن يخبر صاحبه حين يُصلَح. والثمن
// اتصالٌ واحد يوميًا بـGitHub — مُعلَنٌ في الإعدادات، ويُطفأ بمفتاح.

const LATEST_URL = 'https://api.github.com/repos/elzeerx/kunnash/releases/latest';
const DAY_MS = 24 * 60 * 60 * 1000;

/** «0.3.1» ← [0,3,1] · ما ليس رقمًا يصير صفرًا فلا يرمي على وسمٍ غريب */
function parts(v) {
  return String(v || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/**
 * هل b أحدث من a؟
 * المقارنة بالأجزاء لا بالنصّ: «0.10.0» أحدث من «0.9.0» رغم أن النصّ يقول العكس.
 */
function isNewer(current, candidate) {
  const a = parts(current);
  const b = parts(candidate);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

/** هل حان وقت الفحص؟ */
function isDue(lastAt, now = Date.now()) {
  return !lastAt || now - lastAt >= DAY_MS;
}

/**
 * يسأل GitHub عن آخر إصدار.
 * @param {string} current إصدار التطبيق الحالي
 * @param {function} fetchFn حُقنت لتُختبر بلا شبكة
 * @returns {Promise<{newer:boolean, version?:string, url?:string, notes?:string}>}
 */
async function checkLatest(current, fetchFn = fetch) {
  // الفشل ليس خطأً يُعرض: تعذّر الوصول لا يعني شيئًا للمستخدم، ولا يصحّ
  // أن يزعجه تطبيقُه برسالة كل يوم لأن الشبكة كانت بطيئة.
  try {
    const res = await fetchFn(LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kunnash' },
    });
    if (!res.ok) return { newer: false };
    const j = await res.json();
    const tag = j && j.tag_name;
    if (!tag || !isNewer(current, tag)) return { newer: false };
    return {
      newer: true,
      version: String(tag).replace(/^v/i, ''),
      url: j.html_url || 'https://kunnash.app',
      notes: (j.body || '').slice(0, 400),
    };
  } catch {
    return { newer: false };
  }
}

module.exports = { isNewer, isDue, checkLatest, LATEST_URL, DAY_MS };
