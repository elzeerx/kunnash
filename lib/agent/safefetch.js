// جلبٌ لا يصل إلى شبكتك — الحارس الوحيد بين النموذج وبقية العالم.
//
// **العطب الذي بُني هذا لإصلاحه:** الحارس السابق فحص **اسم المضيف نصًّا**
// (`h === 'localhost'`، `/^127\./`). فمرّ `http://localtest.me/` — اسمٌ عامٌّ
// مسجَّل يُترجَم إلى 127.0.0.1 — ووصل خادمًا محليًا على الجهاز فعلًا. وفحصُه
// وقع **مرة واحدة قبل الطلب**، و`fetch` يتبع إعادة التوجيه بنفسه، فرابطٌ
// عامٌّ يردّ 302 إلى 127.0.0.1 كان يصل كذلك.
//
// وهذا يخصّ كُنّاش خاصةً: بطاقة الإذن تعرض العنوان الذي رآه المستخدم، فيوافق
// على `news.example.com` ويذهب الطلب إلى جهازه. **إذنٌ يقول شيئًا ويفعل
// غيره** — وهو نقض المبدأ لا مجرد ثغرة.
//
// الحارس الآن ثلاث طبقات:
//   ١. يُترجم الاسم إلى عناوين، ويفحص **كل** عنوان — لا الاسم.
//   ٢. يتبع إعادة التوجيه **بنفسه** ويعيد الفحص عند كل قفزة.
//   ٣. يثبّت العنوان المفحوص في الاتصال (`lookup`)، فلا يُترجَم الاسم ثانيةً
//      بين الفحص والاتصال — وهذا يغلق سباق DNS، لا يضيّقه.

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const zlib = require('node:zlib');

const MAX_HOPS = 5;
const MAX_BYTES = 5 * 1024 * 1024;   // ما يزيد عن هذا ليس صفحةً تُقرأ
const TIMEOUT_MS = 20000;

/**
 * هل هذا العنوان يخصّ الجهاز أو الشبكة الداخلية؟
 * القاعدة: **ما لا نعرفه نمنعه** — قائمة سماحٍ بالعكس أسلم من قائمة منع.
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    const [a, b] = p;
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    return (
      a === 0 ||                              // «هذه الشبكة»
      a === 10 ||                             // خاص
      a === 127 ||                            // الجهاز نفسه
      (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
      (a === 169 && b === 254) ||             // link-local وبيانات السحابة
      (a === 172 && b >= 16 && b <= 31) ||    // خاص
      (a === 192 && b === 168) ||             // خاص
      (a === 192 && b === 0) ||               // موثّق/خاص بالبروتوكولات
      (a === 198 && (b === 18 || b === 19)) ||// قياس الأداء
      a >= 224                                // بثّ متعدد ومحجوز
    );
  }
  if (net.isIPv6(ip)) {
    const groups = expandIpv6(ip);
    if (!groups) return true;
    // IPv4 مغلَّف: خمس مجموعات أصفار ثم ffff، فالأخيرتان عنوانٌ رابعيّ.
    // ولا تكفي مطابقة النصّ هنا: Node يطبّع «::ffff:127.0.0.1» إلى
    // «::ffff:7f00:1»، فالبحث عن النقاط يخطئها — والتوسيع يراها في الصيغتين.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
      return isPrivateIp(v4);
    }
    if (groups.every((g) => g === 0)) return true;                       // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;   // ::1
    if ((groups[0] & 0xfe00) === 0xfc00) return true;                    // fc00::/7
    if ((groups[0] & 0xffc0) === 0xfe80) return true;                    // fe80::/10
    return false;
  }
  return true;                                // ليس عنوانًا نفهمه
}

/** «::ffff:7f00:1» ← ثمانِ مجموعات رقمية · null إن لم يُفهم */
function expandIpv6(ip) {
  let s = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  // ذيلٌ رابعيّ («::ffff:127.0.0.1») يُحوَّل مجموعتين قبل التوسيع
  const tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const b = tail[1].split('.').map(Number);
    if (b.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hex = [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)];
    s = s.slice(0, -tail[1].length) + hex.join(':');
  }
  const [head, rest, extra] = s.split('::');
  if (extra !== undefined) return null;                 // «::» مرتين لا تصحّ
  const toNums = (part) => (part ? part.split(':').filter(Boolean).map((g) => parseInt(g, 16)) : []);
  const left = toNums(head);
  const right = rest === undefined ? [] : toNums(rest);
  const fill = 8 - left.length - right.length;
  if (rest === undefined) return left.length === 8 && left.every(Number.isFinite) ? left : null;
  if (fill < 0) return null;
  const out = [...left, ...Array(fill).fill(0), ...right];
  return out.length === 8 && out.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? out : null;
}

/** «LOCALHOST.» ← «localhost» · «[::1]» ← «::1» */
function normalizeHost(hostname) {
  return String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * يفحص الرابط ويرجع عناوينه المتحقَّق منها.
 * @returns {Promise<{url: URL, host: string, addresses: {address: string, family: number}[]}>}
 */
async function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error('الرابط غير صالح.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('يُقبل http/https فقط.');
  }
  const host = normalizeHost(u.hostname);
  if (!host) throw new Error('الرابط بلا مضيف.');

  // اسمٌ محجوز للجهاز مهما ترجمته الشبكة
  if (host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('لا وصول لعناوين الشبكة المحلية أو الداخلية.');
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('لا وصول لعناوين الشبكة المحلية أو الداخلية.');
    return { url: u, host, addresses: [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] };
  }

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error(`تعذّرت ترجمة العنوان «${host}» — تحقّق من الرابط أو من الشبكة.`);
  }
  if (!addresses.length) throw new Error(`لا عنوان للمضيف «${host}».`);
  // **كل** عنوان يُفحص: اسمٌ يعطي عنوانًا عامًّا وآخر محليًّا يُمنع
  for (const a of addresses) {
    if (isPrivateIp(a.address)) {
      throw new Error(`«${host}» يشير إلى عنوان داخلي (${a.address}) — لا وصول للشبكة المحلية.`);
    }
  }
  return { url: u, host, addresses };
}

/** طلبٌ واحد بلا اتّباع إعادة توجيه، وعنوانه مثبَّت على ما فُحص */
function requestOnce({ url, addresses }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      // تثبيت العنوان: لا تُترجَم الاسم ثانيةً بين الفحص والاتصال.
      // بدونه يبقى سباقٌ يبدّل الإجابة بعد الفحص وقبل الوصل.
      lookup: (_host, opts, cb) => {
        if (opts && opts.all) return cb(null, addresses);
        const first = addresses[0];
        return cb(null, first.address, first.family);
      },
      headers: {
        'User-Agent': 'Kunnash (personal desk app)',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      let size = 0;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const sink = enc === 'gzip' ? zlib.createGunzip()
        : enc === 'deflate' ? zlib.createInflate()
          : null;
      const stream = sink ? res.pipe(sink) : res;
      stream.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); reject(new Error('الصفحة أكبر من ٥ ميجابايت.')); return; }
        chunks.push(c);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('انتهت مهلة الطلب.')); });
    req.on('error', (e) => reject(new Error(`تعذّر الوصول: ${e.message}`)));
    req.end();
  });
}

/**
 * جلبٌ آمن: يفحص كل قفزة على حدة.
 * @returns {Promise<{status:number, headers:object, body:string, finalUrl:string}>}
 */
async function safeFetch(raw) {
  let target = raw;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const checked = await checkUrl(target);
    const res = await requestOnce(checked);
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop === MAX_HOPS) throw new Error('إعادات توجيه كثيرة — توقّفنا.');
      // النسبي يُحلّ على الحالي، والمطلق يُفحص من جديد كأنه رابطٌ أول
      target = new URL(loc, checked.url).href;
      continue;
    }
    if (res.status < 200 || res.status >= 400) throw new Error(`الخادم ردّ ${res.status}.`);
    return { ...res, finalUrl: checked.url.href };
  }
  throw new Error('إعادات توجيه كثيرة — توقّفنا.');
}

module.exports = { safeFetch, checkUrl, isPrivateIp, normalizeHost, MAX_HOPS };
