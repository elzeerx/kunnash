// فحص الإصدار — المقارنة والمهلة والفشل الصامت

const test = require('node:test');
const assert = require('node:assert');
const { isNewer, isDue, checkLatest, DAY_MS } = require('../lib/update');

test('يعرف الأحدث من الأقدم', () => {
  assert.equal(isNewer('0.3.1', '0.4.0'), true);
  assert.equal(isNewer('0.3.1', '0.3.2'), true);
  assert.equal(isNewer('0.3.1', '1.0.0'), true);
  assert.equal(isNewer('0.3.1', '0.3.1'), false, 'المساوي ليس أحدث');
  assert.equal(isNewer('0.4.0', '0.3.9'), false, 'الأقدم لا يُعرض تحديثًا');
});

// النصّ يقول «0.9.0» أكبر من «0.10.0» لأن '9' > '1'. والمقارنة بالأجزاء تنجو.
test('المقارنة بالأجزاء لا بالنصّ', () => {
  assert.equal(isNewer('0.9.0', '0.10.0'), true);
  assert.equal(isNewer('0.10.0', '0.9.0'), false);
});

test('يحتمل بادئة v ووسمًا ناقصًا', () => {
  assert.equal(isNewer('0.3.1', 'v0.4.0'), true);
  assert.equal(isNewer('0.3.1', '0.4'), true, 'الجزء الغائب صفر');
  assert.equal(isNewer('0.3.1', 'وسمٌ غريب'), false, 'ما لا يُقرأ لا يُعرض تحديثًا');
});

test('المهلة يوم كامل', () => {
  const now = 1_700_000_000_000;
  assert.equal(isDue(null, now), true, 'أول مرة يفحص');
  assert.equal(isDue(now - 60_000, now), false, 'قبل دقيقة: لا يُعيد');
  assert.equal(isDue(now - DAY_MS, now), true);
});

test('يعرض الإصدار ورابطه حين يكون أحدث', async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({ tag_name: 'v0.4.0', html_url: 'https://example.test/r', body: 'ما الجديد' }),
  });
  const r = await checkLatest('0.3.1', fake);
  assert.equal(r.newer, true);
  assert.equal(r.version, '0.4.0', 'بلا بادئة v — الرقم للعرض لا للوسم');
  assert.equal(r.url, 'https://example.test/r');
});

test('لا يعرض شيئًا حين يكون المثبَّت هو الأحدث', async () => {
  const fake = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.3.1' }) });
  assert.equal((await checkLatest('0.3.1', fake)).newer, false);
});

// شبكةٌ متعثّرة ليست خبرًا للمستخدم. لو رمى الفحص لظهر خطأٌ كل يوم لمن
// كان خلف جدار حماية — إزعاجٌ بلا فائدة، فالصمت هو الجواب.
test('يبتلع فشل الشبكة ولا يرمي', async () => {
  const boom = async () => { throw new Error('لا شبكة'); };
  assert.equal((await checkLatest('0.3.1', boom)).newer, false);

  const rate = async () => ({ ok: false, status: 403 });
  assert.equal((await checkLatest('0.3.1', rate)).newer, false);

  const junk = async () => ({ ok: true, json: async () => ({}) });
  assert.equal((await checkLatest('0.3.1', junk)).newer, false);
});
