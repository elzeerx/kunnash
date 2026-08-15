// اختبارات مساحة العمل والإعدادات — دلالات الحفظ التي تحمي المستخدم من نفسه

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// نسخة معزولة من الوحدة كي لا تتقاسم حالة مع test/chat.test.js
delete require.cache[require.resolve('../lib/workspace')];
const ws = require('../lib/workspace');

before(() => {
  ws.init(fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-ud-')));
});

describe('دلالات حفظ الاتصال', () => {
  test('الحقل غير المُرسل يبقى كما هو', () => {
    ws.saveConnection({ apiKey: 'sk-1', model: 'a/b' });
    ws.saveConnection({ model: 'c/d' });          // بلا apiKey
    assert.strictEqual(ws.loadConnection().apiKey, 'sk-1');
    assert.strictEqual(ws.loadConnection().model, 'c/d');
  });

  test('الحقل الممسوح يعود للافتراضي لا يطمسه بفراغ', () => {
    ws.saveConnection({ baseUrl: 'https://example.org/v1' });
    ws.saveConnection({ baseUrl: '' });           // مسحه المستخدم
    assert.strictEqual(ws.loadConnection().baseUrl, undefined,
      'الفارغ يجب أن يُحذف من الملف فيسري الافتراضي عند الدمج');
  });

  test('مساحة عمل غير موجودة تُرفض', () => {
    assert.throws(() => ws.setWorkspace('/لا/يوجد/إطلاقًا'), /ليس مجلدًا/);
  });

  test('بلا مساحة عمل: requireWorkspace يرمي رسالة مفهومة', () => {
    assert.throws(() => ws.requireWorkspace(), /لم تُختر مساحة عمل/);
  });
});

describe('إزالة الوصول لمساحة عمل', () => {
  // الثغرة: workspace:forget كانت تشيل المساحة من القائمة، فإن كانت
  // **الحالية** بقي التطبيق عاملًا عليها ويعيدها الإقلاع التالي من
  // `workspace` المحفوظ — إزالةٌ تكذب على صاحبها.
  test('إزالة غير الحالية: تُشال والحالية باقية', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-b-'));
    ws.setWorkspace(a);
    ws.setWorkspace(b);
    const res = ws.forgetWorkspace(a);
    assert.strictEqual(res.wasCurrent, false);
    assert.ok(!ws.listWorkspaces().some((w) => w.path === a));
    assert.strictEqual(ws.getWorkspace(), b);
  });

  test('إزالة الحالية: تُصفَّر ولا يعيدها الإقلاع', () => {
    const c = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-c-'));
    ws.setWorkspace(c);
    const res = ws.forgetWorkspace(c);
    assert.strictEqual(res.wasCurrent, true);
    assert.strictEqual(ws.getWorkspace(), null, 'الحالية تُصفَّر فورًا');
    assert.throws(() => ws.requireWorkspace(), /لم تُختر/);
    assert.strictEqual(ws.listWorkspaces().some((w) => w.path === c), false);
  });

  test('الإزالة لا تمس ملفات المجلد نفسه', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-ws-d-'));
    fs.writeFileSync(path.join(d, 'ملف.txt'), 'محتوى');
    ws.setWorkspace(d);
    ws.forgetWorkspace(d);
    assert.strictEqual(fs.readFileSync(path.join(d, 'ملف.txt'), 'utf8'), 'محتوى');
  });
});
