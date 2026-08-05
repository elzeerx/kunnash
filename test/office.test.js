// اختبارات ziplite وoffice — دورة كاملة: نبني بأيدينا ونقرأ بأيدينا.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readZip, writeZip } = require('../lib/agent/ziplite');
const { xlsxToCsv, docxToText, buildDocx, buildHtml } = require('../lib/agent/office');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-office-'));

describe('ziplite', () => {
  test('دورة كاملة: كتابة ثم قراءة بمحتوى عربي وثنائي', () => {
    const files = [
      { name: 'ملف.txt', data: 'مرحبًا بالعالم' },
      { name: 'dir/inner.bin', data: Buffer.from([0, 1, 2, 255, 254]) },
    ];
    const zip = writeZip(files);
    const back = readZip(zip);
    assert.strictEqual(back.get('ملف.txt').toString('utf8'), 'مرحبًا بالعالم');
    assert.deepStrictEqual([...back.get('dir/inner.bin')], [0, 1, 2, 255, 254]);
  });

  test('ملف غير ZIP يرفض برسالة مفهومة', () => {
    assert.throws(() => readZip(Buffer.from('هذا نص عادي وليس أرشيفًا')), /ليس ملف ZIP/);
  });
});

describe('xlsx', () => {
  // نبني xlsx حقيقيًا بأنفسنا عبر ziplite — نصوص مشتركة وأرقام وفجوات أعمدة
  function makeXlsx() {
    const file = path.join(tmp(), 'جدول.xlsx');
    fs.writeFileSync(file, writeZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      {
        name: 'xl/workbook.xml',
        data: '<workbook xmlns:r="x"><sheets><sheet name="فواتير" sheetId="1" r:id="rId1"/><sheet name="ملخص" sheetId="2" r:id="rId2"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>',
      },
      {
        name: 'xl/sharedStrings.xml',
        data: '<sst><si><t>المورّد</t></si><si><t>المبلغ</t></si><si><r><t>شركة </t></r><r><t>النور</t></r></si></sst>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1500.5</v></c></row>' +
          '<row r="3"><c r="A3" t="inlineStr"><is><t>text, with comma</t></is></c><c r="B3" t="b"><v>1</v></c></row>' +
          '</sheetData></worksheet>',
      },
      { name: 'xl/worksheets/sheet2.xml', data: '<worksheet><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>' },
    ]));
    return file;
  }

  test('قراءة الأوراق: نصوص مشتركة ومقاطع مدموجة وفجوات وأرقام', () => {
    const sheets = xlsxToCsv(makeXlsx());
    assert.strictEqual(sheets.length, 2);
    const lines = sheets[0].csv.split('\n');
    assert.strictEqual(lines[0], 'المورّد,المبلغ');
    assert.strictEqual(lines[1], 'شركة النور,,1500.5');       // فجوة العمود B محفوظة
    assert.strictEqual(lines[2], '"text, with comma",TRUE');   // اقتباس CSV سليم
    assert.strictEqual(sheets[1].csv, '42');
  });

  test('طلب ورقة باسمها، والاسم الخاطئ يعدّد الموجود', () => {
    const f = makeXlsx();
    assert.strictEqual(xlsxToCsv(f, 'ملخص')[0].csv, '42');
    assert.throws(() => xlsxToCsv(f, 'غلط'), /فواتير، ملخص/);
  });
});

describe('docx', () => {
  test('دورة كاملة: بناء مستند ثم استخراج نصه', () => {
    const buf = buildDocx({
      title: 'تقرير الأسبوع',
      content: '# الإنجازات\nأُنجز التقرير الأول.\n\nوهذه فقرة ثانية\nبسطرين.',
    });
    const file = path.join(tmp(), 'تقرير.docx');
    fs.writeFileSync(file, buf);

    const text = docxToText(file);
    assert.match(text, /تقرير الأسبوع/);
    assert.match(text, /الإنجازات/);
    assert.match(text, /أُنجز التقرير الأول\./);
    assert.match(text, /بسطرين/);
  });

  test('محارف XML الخاصة تنجو من الدورة', () => {
    const buf = buildDocx({ title: 'أ&ب', content: 'س < ص و"اقتباس"' });
    const file = path.join(tmp(), 'خاص.docx');
    fs.writeFileSync(file, buf);
    const text = docxToText(file);
    assert.match(text, /أ&ب/);
    assert.match(text, /س < ص/);
  });
});

describe('html', () => {
  test('عناوين وقوائم وفقرات، وهروب الوسوم', () => {
    const html = buildHtml({ title: 'عرض', content: '# قسم\nفقرة فيها <script>خطر</script>\n- بند أول\n- بند ثانٍ' });
    assert.match(html, /<h2>قسم<\/h2>/);
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes('<script>خطر'));
    assert.match(html, /<li>بند أول<\/li>/);
    assert.match(html, /dir="rtl"/);
  });
});
