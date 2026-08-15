// المرفقات → أجزاء رسالة.
//
// الباب الذي بقي مغلقًا على مفكّكٍ يعمل: بُني قارئ xlsx/docx في م٣ ووُصل
// بالأدوات وحدها، فظل المرفق يرمي «لم تُبنَ بعد» — فظنّ المستخدم أن التطبيق
// لا يقرأ الملفات. هذه الاختبارات تحرس أن الطريق موصولٌ من الطرفين.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildMessageParts } = require('../lib/attachments');
const { writeZip } = require('../lib/agent/ziplite');
const { buildDocx } = require('../lib/agent/office');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-attach-'));

function makeXlsx(dir) {
  const file = path.join(dir, 'ميزانية.xlsx');
  fs.writeFileSync(file, writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="بنود" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>البند</t></is></c><c r="B1"><v>1250</v></c></row></sheetData></worksheet>' },
  ]));
  return file;
}

describe('المرفقات', () => {
  test('جدول xlsx يُقرأ ولا يُرفض', () => {
    const [part] = buildMessageParts([makeXlsx(tmp())]);
    assert.strictEqual(part.type, 'text');
    assert.match(part.text, /ميزانية\.xlsx/, 'يسمّي الملف للنموذج');
    assert.match(part.text, /=== ورقة: بنود ===/, 'يسمّي الورقة');
    assert.match(part.text, /البند,1250/, 'والبيانات نفسها حاضرة');
  });

  test('مستند docx يُقرأ نصًّا', () => {
    const file = path.join(tmp(), 'خطاب.docx');
    fs.writeFileSync(file, buildDocx({ title: 'تقرير يوليو', content: 'الفقرة الأولى' }));
    const [part] = buildMessageParts([file]);
    assert.match(part.text, /تقرير يوليو/);
    assert.match(part.text, /الفقرة الأولى/);
  });

  // «تعذّرت القراءة» وحدها لا تدلّ على شيء — سبب العطب يُنقل كما هو
  test('ملف تالف يفشل برسالة تحمل السبب واسم الملف', () => {
    const file = path.join(tmp(), 'تالف.xlsx');
    fs.writeFileSync(file, 'ليس أرشيفًا إطلاقًا');
    assert.throws(() => buildMessageParts([file]), (e) => {
      assert.match(e.message, /تالف\.xlsx/, 'يسمّي الملف');
      assert.match(e.message, /ZIP/, 'وينقل سبب العطب');
      return true;
    });
  });

  // ما لم يُبنَ له مفكّك يبقى مرفوضًا برسالة تدلّ على المخرج — لا يُدّعى دعمه
  test('PDF ما زال مرفوضًا برسالة تقترح بديلًا', () => {
    const file = path.join(tmp(), 'ورقة.pdf');
    fs.writeFileSync(file, '%PDF-1.4');
    assert.throws(() => buildMessageParts([file]), /لم تُبنَ بعد/);
  });

  test('النصّ والصورة يمرّان كما كانا', () => {
    const dir = tmp();
    const txt = path.join(dir, 'ملاحظات.md');
    fs.writeFileSync(txt, '# عنوان');
    const png = path.join(dir, 'صورة.png');
    fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const parts = buildMessageParts([txt, png]);
    assert.match(parts[0].text, /# عنوان/);
    assert.strictEqual(parts[1].type, 'image_url');
    assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);
  });
});
