// حزم المهن — مهارات جاهزة تُنسخ إلى مساحة العمل عند أول تشغيل.
//
// الحزمة **ملفات لا بيانات في الكود**: كل مهارة SKILL.md حقيقي تحت
// assets/packs/. فما يُثبَّت يصير ملك المستخدم — يقرؤه ويعدّله ويرسله لزميله
// ويحذفه. ولو كانت الحزم مضمّنة في الشيفرة لصارت شيئًا يملكه التطبيق لا هو.
//
// والتثبيت **نسخٌ لا ربط**: تعديل المستخدم لمهارة مثبّتة لا يضيع بتحديث
// التطبيق، ولا يُطمَس ما عدّله — التثبيت يتخطى ما له نفس المعرّف.

const fs = require('fs');
const path = require('path');

const library = require('./library');

const PACKS_DIR = path.resolve(__dirname, '..', 'assets', 'packs');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** كل الحزم المتاحة مع عدد مهاراتها وأسمائها */
function list() {
  let dirs;
  try { dirs = fs.readdirSync(PACKS_DIR, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const meta = readJson(path.join(PACKS_DIR, d.name, 'pack.json'), null);
    if (!meta) continue;
    const skillsDir = path.join(PACKS_DIR, d.name, 'skills');
    let skills = [];
    try {
      skills = fs.readdirSync(skillsDir)
        .filter((s) => fs.existsSync(path.join(skillsDir, s, 'SKILL.md')));
    } catch { /* حزمة بلا مهارات */ }
    out.push({ ...meta, id: d.name, skills });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'ar'));
}

/**
 * ينسخ مهارات الحزمة إلى مساحة العمل عبر المكتبة (مالكة `.kunnash/`).
 * ما له نفس المعرّف يُتخطّى — لا نطمس عمل المستخدم.
 * @returns {{ installed: string[], skipped: string[] }}
 */
function install(root, packId) {
  const pack = list().find((p) => p.id === packId);
  if (!pack) throw new Error(`لا توجد حزمة بالمعرّف «${packId}»`);

  const existing = new Set(library.listLibrary(root).skills.map((s) => s.id));
  const installed = [];
  const skipped = [];

  for (const sid of pack.skills) {
    if (existing.has(sid)) { skipped.push(sid); continue; }
    const body = fs.readFileSync(path.join(PACKS_DIR, packId, 'skills', sid, 'SKILL.md'), 'utf8');
    library.saveItem(root, 'skill', sid, body);
    installed.push(sid);
  }
  return { installed, skipped };
}

module.exports = { list, install, PACKS_DIR };
