// قراءة xlsx/docx وكتابة docx/html — فوق ziplite، بلا تبعيات.
//
// القراءة بتحليل XML مبسّط (regex على ملفات أوفيس المُولَّدة آليًا — بنيتها
// منتظمة). ليست محلل XML عامًا ولا تدّعي ذلك؛ ما يفشل يفشل برسالة واضحة
// تدل المستخدم على تصديرٍ بديل.

const fs = require('fs');
const { readZip, writeZip } = require('./ziplite');

// ---------- أدوات XML ----------
function xmlDecode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
function xmlEncode(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- xlsx → CSV ----------
function colToIndex(ref) {
  // «C7» ← العمود C = 2
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function csvCell(v) {
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

// صفةٌ من وسم بلا افتراض ترتيب. الاعتماد على «name ثم r:id» أسقط ملفات
// openpyxl وأخواتها كلها: إكسل يكتب الصفات بترتيبٍ ما، وغيره بغيره،
// وXML لا يعد بترتيبٍ أصلًا. عطبان حقيقيان خرجا من هذا الافتراض:
// «لا أوراق في الملف» على ملف سليم، وأسوأ منه CSV فارغ **بصمت**.
function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

// التاريخ في إكسل رقمٌ تسلسلي، ومعناه في **نمط الخلية** لا في قيمتها.
// من تجاهل الأنماط قرأ 45870 حيث كتب المستخدم 2025-08-01 — أرقامٌ صحيحة
// الحروف فاسدة المعنى. فنقرأ styles.xml ونحوّل ما نمطُه تاريخٌ فقط.
const DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);
function isDateFormat(code) {
  // يُشطب المقتبس «"ر.س"» والألوان «[Red]» والمهرَّب «\y» ثم يُبحث عن
  // حروف التاريخ. y/d لا تظهر إلا في التواريخ، وh في الأوقات — أما m وحدها
  // فمبهمة (دقائق أم شهر) ولا تكفي دليلًا.
  const bare = String(code).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
  return /[ydh]/i.test(bare);
}
function parseStyles(entries) {
  const xml = entries.get('xl/styles.xml');
  if (!xml) return [];
  const s = xml.toString('utf8');
  const custom = new Map();
  for (const m of s.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    custom.set(Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode') || '');
  }
  const xfsBlock = (s.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
  return [...xfsBlock.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') || 0);
    return DATE_FMT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)));
  });
}
function serialToDate(serial, date1904) {
  // الأساس 1899-12-30 (أو 1904-01-01): التحويل القياسي الذي تتفق عليه
  // القارئات، ويحتمل غلطة يوم كبيسة 1900 الموروثة في إكسل نفسه.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(epoch + ms);
  if (isNaN(d)) return String(serial);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  let out = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const frac = ms % 86400000;
  if (frac) {
    out += ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    if (d.getUTCSeconds()) out += `:${pad(d.getUTCSeconds())}`;
  }
  return out;
}

/** يقرأ ملف xlsx ويرجع [{name, csv}] لكل ورقة (أو الورقة المطلوبة) */
function xlsxToCsv(filePath, sheetName) {
  const entries = readZip(fs.readFileSync(filePath));

  // النصوص المشتركة: <si> قد يحوي <t> مباشرًا أو مقاطع <r><t> تُدمج.
  // وتُشطب <rPh> قبل الدمج: لفظٌ صوتي مساعد (ياباني غالبًا) لا جزء من
  // النص — دمجُه أخرج «محمدムハンマド» من خلية اسمها «محمد».
  const shared = [];
  const ss = entries.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = ss.toString('utf8');
    for (const si of xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || []) {
      const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
      const texts = [...clean.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1]));
      shared.push(texts.join(''));
    }
  }

  const dateStyles = parseStyles(entries);

  // أسماء الأوراق ← معرفات العلاقات ← مسارات الملفات
  const wb = entries.get('xl/workbook.xml');
  if (!wb) throw new Error('ليس ملف Excel صالحًا (لا workbook)');
  const wbXml = wb.toString('utf8');
  const date1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/.test(wbXml);
  const rels = new Map();
  const relXml = (entries.get('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8');
  for (const m of relXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const target = attr(m[1], 'Target');
    if (!target) continue;
    rels.set(attr(m[1], 'Id'), target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
  }
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name');
    if (name === undefined) continue;
    sheets.push({ name: xmlDecode(name), path: rels.get(attr(m[1], 'r:id')) });
  }
  if (!sheets.length) throw new Error('لا أوراق في الملف');

  const wanted = sheetName ? sheets.filter((s) => s.name === sheetName) : sheets;
  if (!wanted.length) {
    throw new Error(`لا ورقة باسم «${sheetName}» — الموجود: ${sheets.map((s) => s.name).join('، ')}`);
  }

  return wanted.map(({ name, path: p }) => {
    const sheetEntry = p && entries.get(p);
    // ورقة معلَنة بلا ملف: عطبٌ يُسمّى لا CSV فارغ يوهم أن الورقة خالية
    if (!sheetEntry) throw new Error(`ورقة «${name}» معلنة في الملف لكن محتواها مفقود — الملف ناقص أو من مولِّد غير قياسي.`);
    const xml = sheetEntry.toString('utf8');
    const rows = [];
    for (const rowM of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      // الصفوف الفارغة تُحفظ فارغةً لا تُطوى: طيُّها يُزيح كل ما بعدها،
      // فما في الصف السابع يُروى للنموذج أنه في الثالث — والمستخدم يسأل
      // عن جدوله الذي يراه هو، بأرقام صفوفه هو.
      const rNum = Number(attr(rowM[1], 'r'));
      if (rNum > 0) while (rows.length < rNum - 1) rows.push('');
      const cells = [];
      for (const cM of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cM[1];
        const inner = cM[2] || '';
        const ref = attr(attrs, 'r');
        const type = attr(attrs, 't');
        let v = '';
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (type === 's') v = shared[Number(vM && vM[1])] ?? '';
        else if (type === 'inlineStr') {
          v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join('');
        } else if (type === 'b') v = vM && vM[1] === '1' ? 'TRUE' : 'FALSE';
        else {
          v = vM ? xmlDecode(vM[1]) : '';
          if (v && (type === undefined || type === 'n') && dateStyles[Number(attr(attrs, 's'))]) {
            const num = Number(v);
            if (Number.isFinite(num)) v = serialToDate(num, date1904);
          }
        }
        const idx = ref ? colToIndex(ref) : cells.length;
        cells[idx] = v;
      }
      rows.push([...cells].map((c) => csvCell(c ?? '')).join(','));
    }
    return { name, csv: rows.join('\n') };
  });
}

// ---------- docx → نص ----------
function docxToText(filePath) {
  const entries = readZip(fs.readFileSync(filePath));
  const doc = entries.get('word/document.xml');
  if (!doc) throw new Error('ليس ملف Word صالحًا (لا document.xml)');
  const xml = doc.toString('utf8');

  const paragraphs = [];
  for (const pM of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    const seg = pM[0]
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n');
    const texts = [...seg.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => xmlDecode(m[1]));
    paragraphs.push(texts.join(''));
  }
  return paragraphs.join('\n');
}

// ---------- كتابة docx ----------
// حزمة دنيا صالحة: أنماط أساسية وعنوان وفقرات. تكفي للمسودات — والتنسيق
// الغني للمستخدم في وورد بعدها، فكُنّاش «يسلّم مسودة يكملها الإنسان».
function paragraphXml(text, { heading = 0 } = {}) {
  const props = heading
    ? `<w:pPr><w:pStyle w:val="Heading${heading}"/><w:bidi/></w:pPr>`
    : '<w:pPr><w:bidi/></w:pPr>';
  const runs = text.split('\n').map((line, i) =>
    (i ? '<w:r><w:br/></w:r>' : '') +
    `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${xmlEncode(line)}</w:t></w:r>`,
  ).join('');
  return `<w:p>${props}${runs}</w:p>`;
}

function buildDocx({ title, content }) {
  // ماركداون خفيف: أسطر # عناوين، والباقي فقرات
  const body = [];
  if (title) body.push(paragraphXml(title, { heading: 1 }));
  for (const block of String(content).split(/\n{2,}/)) {
    const h = block.match(/^(#{1,3})\s+(.*)$/s);
    if (h) body.push(paragraphXml(h[2].trim(), { heading: h[1].length }));
    else if (block.trim()) body.push(paragraphXml(block.trim()));
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join('')}<w:sectPr><w:bidi/></w:sectPr></w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${[1, 2, 3].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}">
<w:name w:val="heading ${n}"/><w:rPr><w:b/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`).join('')}
</w:styles>`;

  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/document.xml', data: documentXml },
  ]);
}

// ---------- كتابة HTML ----------
function buildHtml({ title, content }) {
  // الماركداون يُعرض كما هو داخل <pre> محسّن؟ لا — تحويل خفيف: عناوين وفقرات وقوائم
  const lines = String(content).split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${xmlEncode(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (h) out.push(`<h${h[1].length + 1}>${xmlEncode(h[2])}</h${h[1].length + 1}>`);
    else if (line.trim()) out.push(`<p>${xmlEncode(line)}</p>`);
  }
  if (inList) out.push('</ul>');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xmlEncode(title || 'مستند')}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 760px;
         margin: 40px auto; padding: 0 20px; line-height: 1.9; color: #26241F; }
  h1 { border-bottom: 2px solid #E4DED3; padding-bottom: 8px; }
</style>
</head>
<body>
<h1>${xmlEncode(title || '')}</h1>
${out.join('\n')}
</body>
</html>`;
}

module.exports = { xlsxToCsv, docxToText, buildDocx, buildHtml, xmlDecode, xmlEncode };
