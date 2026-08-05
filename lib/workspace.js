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
let cipher = null;       // { encryptString, decryptString } — safeStorage محقونة من main

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// يُستدعى مرة عند الإقلاع بمجلد بيانات التطبيق (app.getPath('userData')).
// crypto اختياري: بدونه يُخزَّن المفتاح نصًا (حال الاختبارات) — main يمرر
// safeStorage دائمًا حين يتيحه النظام.
function init(userDataDir, crypto) {
  configFile = path.join(userDataDir, 'config.json');
  cipher = crypto || null;
  const saved = readConfig().workspace;
  current = saved && fs.existsSync(saved) ? saved : null;
  migrateShape();
  return current;
}

// ---------- تشفير المفتاح ----------
function encrypt(text) {
  return cipher ? cipher.encryptString(text).toString('base64') : null;
}
function decrypt(b64) {
  if (!cipher) return '';
  try { return cipher.decryptString(Buffer.from(b64, 'base64')); } catch { return ''; }
}

// ---------- التخزين لكل خدمة ----------
// المفتاح والنموذج يخصّان الخدمة لا الاتصال ككل: التنقل بين OpenRouter
// وأنثروبيك وOllama لا يفقد مفتاح السابقة ولا اختيار نموذجها، والعودة إليها
// تجدها كما تُركت. المفتاح ما زال لا يغادر العملية الرئيسية.
function hostOf(baseUrl) {
  try { return new URL(String(baseUrl || '')).host.toLowerCase(); } catch { return ''; }
}
function serviceKey(baseUrl) { return hostOf(baseUrl) || '_default'; }

// هجرة الشكل القديم (مفتاح ونموذج مفردان) إلى خريطة الخدمات
function migrateShape() {
  const conn = readConfig().connection;
  if (!conn || conn.services) return;
  const svc = serviceKey(conn.baseUrl);
  const entry = {};
  if (conn.apiKeyEnc) entry.keyEnc = conn.apiKeyEnc;
  else if (conn.apiKey) entry.keyEnc = encrypt(conn.apiKey) || undefined;
  if (!entry.keyEnc && conn.apiKey && !cipher) entry.key = conn.apiKey;
  if (conn.model) entry.model = conn.model;

  const { apiKey, apiKeyEnc, model, ...rest } = conn;
  writeConfig({ connection: { ...rest, services: { [svc]: entry } } });
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
// ويُخزَّن مشفَّرًا بـsafeStorage (مفتاح من Keychain بهوية التطبيق) حين يتاح.
function rawConnection() { return readConfig().connection || {}; }

function loadConnection() {
  const conn = rawConnection();
  const { services = {}, ...top } = conn;
  const entry = services[serviceKey(conn.baseUrl)] || {};
  const out = { ...top };
  if (entry.model) out.model = entry.model;
  const key = entry.keyEnc ? decrypt(entry.keyEnc) : (entry.key || '');
  if (key) out.apiKey = key;
  return out;
}

function saveConnection(patch = {}) {
  const conn = rawConnection();
  const services = { ...(conn.services || {}) };
  const top = { ...conn };
  delete top.services;

  // الحقول العامة
  for (const k of ['baseUrl', 'label', 'dataPolicy']) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v === '') delete top[k];            // مسحه المستخدم — يعود للافتراضي
    else top[k] = v;
  }

  // الحقول الخاصة بالخدمة — تُنسب لعنوان ما بعد التعديل لا ما قبله
  const svc = serviceKey(top.baseUrl);
  const entry = { ...(services[svc] || {}) };
  if (patch.model !== undefined) {
    if (patch.model === '') delete entry.model;
    else entry.model = patch.model;
  }
  if (patch.apiKey !== undefined) {
    delete entry.key; delete entry.keyEnc;
    if (patch.apiKey !== '') {
      const enc = encrypt(patch.apiKey);
      if (enc) entry.keyEnc = enc; else entry.key = patch.apiKey;
    }
  }
  services[svc] = entry;
  writeConfig({ connection: { ...top, services } });
}

// ملخص كل خدمة محفوظة — به تعرف الواجهة ماذا تعرض عند تبديل الخدمة
function connectionServices() {
  const { services = {} } = rawConnection();
  const out = {};
  for (const [host, e] of Object.entries(services)) {
    out[host] = { model: e.model || '', hasKey: Boolean(e.keyEnc || e.key) };
  }
  return out;
}

// ---------- الملف الشخصي ----------
function loadProfile() { return readConfig().profile || {}; }
function saveProfile(patch = {}) {
  const merged = { ...loadProfile() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === '') delete merged[k];
    else merged[k] = v;
  }
  writeConfig({ profile: merged });
}

module.exports = {
  DATA_DIRNAME,
  init, getWorkspace, setWorkspace, requireWorkspace,
  dataDir, dataFile,
  loadConnection, saveConnection, connectionServices, serviceKey,
  loadProfile, saveProfile,
  readJson, writeJson,
};
