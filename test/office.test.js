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

// ما كشفه ملف مستخدم حقيقي: القارئ كان يفترض ترتيب الصفات ويهمل الأنماط
describe('xlsx — أعطاب من ملفات الواقع', () => {
  const zip = (extra) => {
    const file = path.join(tmp(), 'واقعي.xlsx');
    fs.writeFileSync(file, writeZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      ...extra,
    ]));
    return file;
  };

  test('ترتيب الصفات لا يُفترض: r:id قبل name وTarget قبل Id', () => {
    // openpyxl وأخواتها تكتب الصفات بترتيب مغاير لإكسل — وXML لا يعد بترتيب
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet r:id="rId1" sheetId="1" name="مقلوبة"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Target="worksheets/sheet1.xml" Type="ws" Id="rId1"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>وصلت</t></is></c></row></sheetData></worksheet>' },
    ]);
    const [s] = xlsxToCsv(f);
    assert.strictEqual(s.name, 'مقلوبة');
    assert.strictEqual(s.csv, 'وصلت');
  });

  test('التاريخ يخرج تاريخًا لا رقمًا تسلسليًا', () => {
    // 45870 بنمط تاريخ = 2025-08-01، وبلا نمط يبقى رقمًا كما هو
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="ت" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>45870</v></c><c r="B1"><v>45870</v></c><c r="C1" s="1"><v>45870.75</v></c></row></sheetData></worksheet>' },
    ]);
    assert.strictEqual(xlsxToCsv(f)[0].csv, '2025-08-01,45870,2025-08-01 18:00');
  });

  test('نمط تاريخ مخصص يُكشف من formatCode، والمقتبس لا يخدع', () => {
    // «"ر.س"» فيها لا حرف تاريخ بعد شطب المقتبس — أما d/m/yyyy فتاريخ
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="ت" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="d/m/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;د.ك&quot;"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>45870</v></c><c r="B1" s="2"><v>1250.5</v></c></row></sheetData></worksheet>' },
    ]);
    assert.strictEqual(xlsxToCsv(f)[0].csv, '2025-08-01,1250.5');
  });

  test('الصفوف الفارغة تبقى فارغة ولا تُطوى', () => {
    // طيّها يُزيح ما بعدها: ما في الصف الخامس يُروى أنه في الثاني —
    // والمستخدم يسأل عن جدوله الذي يراه، بأرقام صفوفه هو
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="ف" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>أول</t></is></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>خامس</t></is></c></row></sheetData></worksheet>' },
    ]);
    assert.strictEqual(xlsxToCsv(f)[0].csv.split('\n').length, 5);
    assert.strictEqual(xlsxToCsv(f)[0].csv.split('\n')[4], 'خامس');
  });

  test('اللفظ الصوتي rPh يُشطب من النص المشترك', () => {
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="ص" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/sharedStrings.xml', data: '<sst><si><t>محمد</t><rPh sb="0" eb="2"><t>ムハンマド</t></rPh></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
    ]);
    assert.strictEqual(xlsxToCsv(f)[0].csv, 'محمد');
  });

  test('ورقة معلنة بلا محتوى: خطأ يُسمّى لا CSV فارغ يوهم', () => {
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><sheets><sheet name="مفقودة" sheetId="1" r:id="rId9"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships/>' },
    ]);
    assert.throws(() => xlsxToCsv(f), /مفقودة/);
  });

  test('نظام 1904 (ملفات ماك القديمة) يُحترم', () => {
    const f = zip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="x"><workbookPr date1904="1"/><sheets><sheet name="م" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>44408</v></c></row></sheetData></worksheet>' },
    ]);
    // 44408 يومًا من 1904-01-01 = 2025-08-01
    assert.strictEqual(xlsxToCsv(f)[0].csv, '2025-08-01');
  });
});
