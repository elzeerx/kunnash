// نواة كُنّاش المشتركة — المنطق مفصول عن النقل:
// تُحقن بـ emit(channel, payload) لبث الأحداث، وبـ onPermission لطلب الإذن،
// فلا تعرف شيئًا عن Electron ولا عن الواجهة.
//
// المخزن: <مساحة العمل>/.kunnash/

const fs = require('fs');
const path = require('path');

const ws = require('./workspace');
const { PROVIDER_DEFAULTS, streamProviderChat, testProvider } = require('./providers');
const { listLibrary } = require('./library');
const { buildProviderParts } = require('./attachments');

const SESSIONS_FILE = () => ws.dataFile('sessions.json');

// ---------- الجلسات ----------
function loadSessions() {
  if (!ws.getWorkspace()) return [];
  return ws.readJson(SESSIONS_FILE(), []);
}
function saveSessions(sessions) { ws.writeJson(SESSIONS_FILE(), sessions); }

// حفظ جلسة واحدة بإعادة قراءة الملف أولًا — ضروري لتشغيل عدة محادثات معًا:
// الحفظ من مصفوفة قديمة يمسح ما كتبته محادثة أخرى في نفس اللحظة.
function upsertSession(session) {
  const all = loadSessions().filter(s => s.id !== session.id);
  all.push(session);
  saveSessions(all);
}

function sessionSummaries() {
  return loadSessions().map(s => ({
    id: s.id, title: s.title, provider: s.provider, model: s.model,
    createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.messages.length,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}
function getSession(id) { return loadSessions().find(s => s.id === id) || null; }
function deleteSession(id) { saveSessions(loadSessions().filter(s => s.id !== id)); return true; }

// ---------- الإعدادات والمفاتيح ----------
function loadProviderSettings() {
  const saved = ws.loadKeys();
  const merged = {};
  for (const [id, def] of Object.entries(PROVIDER_DEFAULTS)) {
    merged[id] = { ...def, ...(saved[id] || {}) };
  }
  return merged;
}
function loadRawKeys() { return ws.loadKeys(); }
function saveRawKeys(keys) { ws.saveKeys(keys); }

// ---------- لوحة البداية ----------
const SCAN_EXCLUDE = new Set(['node_modules', '.git', '.claude', ws.DATA_DIRNAME]);

function scanRecentFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || out.length > 4000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SCAN_EXCLUDE.has(e.name)) walk(full, depth + 1);
      } else {
        try {
          const st = fs.statSync(full);
          out.push({ name: e.name, rel: path.relative(root, full), mtime: st.mtimeMs });
        } catch { /* تجاهل */ }
      }
    }
  };
  walk(root, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, 5);
}

function dashboardData() {
  const settings = loadProviderSettings();
  const providers = {};
  for (const [id, cfg] of Object.entries(settings)) providers[id] = Boolean(cfg.apiKey);

  const root = ws.getWorkspace();
  if (!root) return { workspace: null, providers, skills: [], recentFiles: [] };

  return {
    workspace: { path: root, name: path.basename(root) },
    providers,
    skills: listLibrary(root).skills,
    recentFiles: scanRecentFiles(root),
  };
}

// ---------- الدردشة (المنطق الموحد) ----------
// emit(channel, payload): يبث الأحداث — IPC في تطبيق الماك
// عقد الأحداث: chat:started · chat:delta · chat:tool · chat:done · chat:error
// كلها تحمل { sessionId, requestId }
//
// ملاحظة م٠: لا حلقة أدوات بعد — المسار الوحيد العامل هو الدردشة المتدفقة عبر
// مزود OpenAI-compatible. حلقة الأدوات تدخل من هذه النقطة نفسها في م٣.
async function chatSend({ sessionId, provider, model, text, attachments, retry, requestId }, emit, _onPermission) {
  ws.requireWorkspace();

  const sessions = loadSessions();
  let session = sessions.find(s => s.id === sessionId);
  const now = Date.now();

  if (!session) {
    session = {
      id: 's' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: text.slice(0, 48) + (text.length > 48 ? '…' : ''),
      provider, model,
      createdAt: now, updatedAt: now,
      messages: [],
    };
    sessions.push(session);
  }
  session.provider = provider;
  session.model = model;
  session.updatedAt = now;

  const attachNames = (attachments || []).map(p => path.basename(p));
  const lastMsg = session.messages[session.messages.length - 1];
  if (!(retry && lastMsg && lastMsg.role === 'user' && lastMsg.text === text)) {
    session.messages.push({ role: 'user', text, ts: now, attachments: attachNames });
  }
  upsertSession(session);

  // requestId يميّز كل تشغيل عن غيره — به تعرف الواجهة أي محادثة يخصّها كل حدث
  const send = (channel, payload) => emit(channel, { sessionId: session.id, requestId, ...payload });
  send('chat:started', { title: session.title, provider, model });

  try {
    const cfg = loadProviderSettings()[provider];
    if (!cfg || !cfg.apiKey) {
      throw new Error(`لم يُدخل مفتاح API لمزود ${cfg ? cfg.label : provider}. افتح الإعدادات ⚙️ وأضف المفتاح.`);
    }
    if (model) cfg.model = model;

    const apiMessages = [
      { role: 'system', content: cfg.systemPrompt },
      ...session.messages.slice(-20).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
    ];
    if (attachments && attachments.length) {
      const parts = buildProviderParts(attachments);
      const last = apiMessages[apiMessages.length - 1];
      last.content = [{ type: 'text', text: last.content }, ...parts];
    }

    const fullText = await streamProviderChat({
      cfg, messages: apiMessages,
      onDelta: (chunk) => send('chat:delta', { chunk }),
    });

    session.messages.push({ role: 'assistant', text: fullText, ts: Date.now(), provider, model });
    session.updatedAt = Date.now();
    upsertSession(session);

    send('chat:done', { text: fullText });
    return { ok: true, sessionId: session.id };
  } catch (err) {
    upsertSession(session);
    send('chat:error', { message: String(err && err.message || err) });
    return { ok: false, sessionId: session.id, error: String(err && err.message || err) };
  }
}

module.exports = {
  loadSessions, saveSessions, sessionSummaries, getSession, deleteSession,
  loadProviderSettings, loadRawKeys, saveRawKeys,
  dashboardData, chatSend, testProvider,
};
