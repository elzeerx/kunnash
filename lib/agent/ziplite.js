// قارئ/كاتب ZIP خفيف فوق zlib المدمجة — بلا تبعية خارجية.
//
// هذا هو «قرار التبعية الواحد» المؤجل من م٠: ملفات xlsx وdocx حاويات ZIP
// لملفات XML، وNode يحمل zlib أصلًا. مئة وخمسون سطرًا هنا تحلّ قراءة الجداول
// والمستندات وكتابتها معًا، وتُبقي قاعدة «صفر تبعيات تشغيل» قائمة.
//
// المدعوم: طريقتا التخزين store وdeflate — وهما كل ما تنتجه أوفيس وأخواتها.

const zlib = require('zlib');

// ---------- CRC32 (يلزم كاتب ZIP) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- القراءة ----------
// نهاية السجل المركزي (EOCD) في آخر الملف — نمسح آخر 64ك بحثًا عن توقيعها
function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('ليس ملف ZIP صالحًا (لا توجد نهاية سجل)');
}

/** يقرأ كل مداخل الأرشيف: Map<اسم المدخل، Buffer المحتوى> */
function readZip(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('سجل مركزي تالف');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // الرأس المحلي له أطوال extra مستقلة عن المركزي — تُقرأ من موضعها
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    if (method === 0) entries.set(name, Buffer.from(raw));
    else if (method === 8) entries.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`طريقة ضغط غير مدعومة (${method}) في ${name}`);

    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- الكتابة ----------
/** يبني أرشيفًا من [{name, data: Buffer|string}] — كله deflate */
function writeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // الإصدار المطلوب
    local.writeUInt16LE(0x0800, 6);          // علم UTF-8
    local.writeUInt16LE(8, 8);               // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));

    offset += 30 + name.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

module.exports = { readZip, writeZip, crc32 };
