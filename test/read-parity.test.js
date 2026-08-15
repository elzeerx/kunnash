// تكافؤ الطريقين: ما يُقرأ مرفقًا يُقرأ من المجلد، والعكس.
//
// كان الطريقان يفترقان: المرفق يرفض xlsx والمفكّك مبنيّ، وread_file يقرأ
// كل شيء utf8 فيُخرج بايتات xlsx مشوّهة كأنها محتوى. وهذه تحرس التقاءهما.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TOOL_MAP } = require('../lib/agent/tools');
const { writeZip } = require('../lib/agent/ziplite');
const { buildDocx } = require('../lib/agent/office');
const { buildMessageParts } = require('../lib/attachments');
const { kindOf } = require('../lib/filetypes');

const ws = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-parity-'));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sheetAt(dir, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="ورقة" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>قيمة</t></is></c></row></sheetData></worksheet>' },
  ]));
  return file;
}

describe('read_file يفرّع بالعائلة', () => {
  // كان يقرأ utf8 مهما كان النوع، فيُخرج آلاف المحارف المشوّهة من xlsx —
  // أسوأ من خطأ: تُنفق رموز المستخدم وتُضلّل النموذج بضجيجٍ يظنّه محتوى
  test('xlsx يُقرأ جدولًا لا بايتات مشوّهة', () => {
    const root = ws();
    sheetAt(root, 'جدول.xlsx');
    const out = TOOL_MAP.get('read_file').exec({ path: 'جدول.xlsx' }, { root });
    assert.match(out, /قيمة/);
    assert.ok(!out.includes('PK'), 'لا بايتات خامة تتسرب');
  });

  test('docx يُقرأ نصًّا من read_file نفسها', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'خطاب.docx'), buildDocx({ title: 'عنوان', content: 'متن' }));
    const out = TOOL_MAP.get('read_file').exec({ path: 'خطاب.docx' }, { root });
    assert.match(out, /عنوان/);
    assert.match(out, /متن/);
  });

  test('الصورة تُحال إلى view_image لا تُقرأ نصًّا', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'غلاف.png'), PNG);
    assert.match(TOOL_MAP.get('read_file').exec({ path: 'غلاف.png' }, { root }), /view_image/);
  });

  test('ما لا مفكّك له يرمي خطأً يدلّ بدل أن يُقرأ خامًا', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'ورقة.pdf'), '%PDF-1.4');
    assert.throws(() => TOOL_MAP.get('read_file').exec({ path: 'ورقة.pdf' }, { root }), /ورقة/);
  });

  test('النصّ والشيفرة يمرّان بترقيم الأسطر كما كانا', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'س.py'), 'x = 1\ny = 2');
    assert.match(TOOL_MAP.get('read_file').exec({ path: 'س.py' }, { root }), /1\tx = 1/);
  });
});

describe('view_image', () => {
  test('يسجّل الصورة في السياق لتلحقها الحلقة برسالة', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'غلاف.png'), PNG);
    const ctx = { root, pendingImages: [] };
    const out = TOOL_MAP.get('view_image').exec({ path: 'غلاف.png' }, ctx);
    assert.strictEqual(ctx.pendingImages.length, 1);
    assert.strictEqual(ctx.pendingImages[0].rel, 'غلاف.png');
    assert.match(ctx.pendingImages[0].url, /^data:image\/png;base64,/);
    assert.match(out, /غلاف\.png/);
  });

  test('ما ليس صورة يُرفض، والفشل لا يترك أثرًا', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'ملف.md'), '#');
    const ctx = { root, pendingImages: [] };
    assert.throws(() => TOOL_MAP.get('view_image').exec({ path: 'ملف.md' }, ctx), /ليست صورة/);
    assert.throws(() => TOOL_MAP.get('view_image').exec({ path: '../خارج.png' }, ctx));
    assert.strictEqual(ctx.pendingImages.length, 0);
  });

  test('سقف الصور في التشغيل الواحد — الصور أثقل الأجزاء', () => {
    const root = ws();
    fs.writeFileSync(path.join(root, 'ص.png'), PNG);
    const ctx = { root, pendingImages: [] };
    for (let i = 0; i < 6; i++) TOOL_MAP.get('view_image').exec({ path: 'ص.png' }, ctx);
    assert.throws(() => TOOL_MAP.get('view_image').exec({ path: 'ص.png' }, ctx), /حدّ/);
  });

  test('قراءة حرة بلا إذن — النظر لا يغيّر شيئًا', () => {
    assert.strictEqual(TOOL_MAP.get('view_image').permission, 'none');
  });
});

// الحارس الحقيقي ضد تكرار العطب الأصلي: الطريقان يقبلان الشيء نفسه
describe('تكافؤ المرفق والمجلد', () => {
  test('كل نوعٍ مدعومٍ يُقرأ من الطريقين معًا', () => {
    const root = ws();
    const cases = [
      { file: sheetAt(root, 'جدول.xlsx'), needle: /قيمة/ },
      { file: (() => { const f = path.join(root, 'خطاب.docx'); fs.writeFileSync(f, buildDocx({ title: 'ع', content: 'متن' })); return f; })(), needle: /متن/ },
      { file: (() => { const f = path.join(root, 'نصّ.md'); fs.writeFileSync(f, 'سطر'); return f; })(), needle: /سطر/ },
    ];
    for (const { file, needle } of cases) {
      const name = path.basename(file);
      assert.match(buildMessageParts([file])[0].text, needle, `المرفق: ${name}`);
      assert.match(TOOL_MAP.get('read_file').exec({ path: name }, { root }), needle, `المجلد: ${name}`);
    }
  });

  test('وكل نوعٍ مرفوضٍ يُرفض من الطريقين معًا', () => {
    const root = ws();
    for (const name of ['ورقة.pdf', 'شرائح.pptx', 'قديم.xls']) {
      const file = path.join(root, name);
      fs.writeFileSync(file, 'x');
      assert.strictEqual(kindOf(file), 'unsupported', name);
      assert.throws(() => buildMessageParts([file]), `المرفق قبِل ${name}`);
      assert.throws(() => TOOL_MAP.get('read_file').exec({ path: name }, { root }), `المجلد قبِل ${name}`);
    }
  });
});
