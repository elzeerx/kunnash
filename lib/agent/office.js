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

/** يقرأ ملف xlsx ويرجع [{name, csv}] لكل ورقة (أو الورقة المطلوبة) */
function xlsxToCsv(filePath, sheetName) {
  const entries = readZip(fs.readFileSync(filePath));

  // النصوص المشتركة: <si> قد يحوي <t> مباشرًا أو مقاطع <r><t> تُدمج
  const shared = [];
  const ss = entries.get('xl/sharedStrings.xml');
  if (ss) {
    const xml = ss.toString('utf8');
    for (const si of xml.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || []) {
      const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1]));
      shared.push(texts.join(''));
    }
  }

  // أسماء الأوراق ← معرفات العلاقات ← مسارات الملفات
  const wb = entries.get('xl/workbook.xml');
  if (!wb) throw new Error('ليس ملف Excel صالحًا (لا workbook)');
  const rels = new Map();
  const relXml = (entries.get('xl/_rels/workbook.xml.rels') || Buffer.alloc(0)).toString('utf8');
  for (const m of relXml.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    rels.set(m[1], m[2].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
  }
  const sheets = [];
  for (const m of wb.toString('utf8').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    sheets.push({ name: xmlDecode(m[1]), path: rels.get(m[2]) });
  }
  if (!sheets.length) throw new Error('لا أوراق في الملف');

  const wanted = sheetName ? sheets.filter((s) => s.name === sheetName) : sheets;
  if (!wanted.length) {
    throw new Error(`لا ورقة باسم «${sheetName}» — الموجود: ${sheets.map((s) => s.name).join('، ')}`);
  }

  return wanted.map(({ name, path: p }) => {
    const xml = (entries.get(p) || Buffer.alloc(0)).toString('utf8');
    const rows = [];
    for (const rowM of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cM of rowM[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cM[1];
        const inner = cM[2] || '';
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const type = (attrs.match(/t="(\w+)"/) || [])[1];
        let v = '';
        const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        if (type === 's') v = shared[Number(vM && vM[1])] ?? '';
        else if (type === 'inlineStr') {
          v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join('');
        } else if (type === 'b') v = vM && vM[1] === '1' ? 'TRUE' : 'FALSE';
        else v = vM ? xmlDecode(vM[1]) : '';
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
