// مساحة العمل — المجلد الذي يشتغل عليه كُنّاش
//
// التطبيق لا يسكن داخل مجلد العمل (كما كان في نسخته الأولى)، بل يفتح مجلدًا
// يختاره المستخدم ويحفظ اختياره في مجلد بيانات التطبيق. فبلا اختيار يفتح
// التطبيق بحالة فارغة — وهذا هو السلوك المقصود لا عطل.
//
// تقسيم التخزين:
//   إعدادات المستخدم (المفاتيح، آخر مساحة عمل) → مجلد بيانات التطبيق
//   بيانات العمل (الجلسات، المهارات، النصوص)   → <مساحة العمل>/.kunnash/

const fs = require('fs');
const path = require('path');

const DATA_DIRNAME = '.kunnash';

let configFile = null;   // يُضبط من main.js عند الإقلاع
let current = null;      // مسار مساحة العمل الحالية أو null

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// يُستدعى مرة عند الإقلاع بمجلد بيانات التطبيق (app.getPath('userData'))
function init(userDataDir) {
  configFile = path.join(userDataDir, 'config.json');
  const saved = readConfig().workspace;
  current = saved && fs.existsSync(saved) ? saved : null;
  return current;
}

function readConfig() { return configFile ? readJson(configFile, {}) : {}; }
function writeConfig(patch) { writeJson(configFile, { ...readConfig(), ...patch }); }

function getWorkspace() { return current; }

function setWorkspace(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error('المسار ليس مجلدًا موجودًا');
  }
  current = abs;
  writeConfig({ workspace: abs });
  return abs;
}

// يرمي بدل أن يرجع null — كل مسار يحتاج مساحة عمل يجب أن يتوقف بوضوح
function requireWorkspace() {
  if (!current) throw new Error('لم تُختر مساحة عمل بعد — افتح مجلدًا ليشتغل عليه كُنّاش.');
  return current;
}

// مخزن كُنّاش داخل مساحة العمل
function dataDir() { return path.join(requireWorkspace(), DATA_DIRNAME); }
function dataFile(name) { return path.join(dataDir(), name); }

// ---------- الاتصال بالنموذج (على مستوى المستخدم لا مساحة العمل) ----------
// المفتاح يخص الجهاز لا المجلد: نقل مساحة العمل أو مشاركتها لا ينقل المفتاح معها.
// م٢ ينقله إلى Keychain ويبقى هذا الموضع هو الواجهة.
function loadConnection() { return readConfig().connection || {}; }
function saveConnection(patch) {
  const merged = { ...loadConnection() };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v !== undefined) merged[k] = v;
  }
  writeConfig({ connection: merged });
}

module.exports = {
  DATA_DIRNAME,
  init, getWorkspace, setWorkspace, requireWorkspace,
  dataDir, dataFile,
  loadConnection, saveConnection,
  readJson, writeJson,
};
