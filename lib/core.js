// نواة كُنّاش — المنطق مفصول عن النقل: تُحقن بـ emit(channel, payload) لبث
// الأحداث وبـ onPermission لطلب الإذن، فلا تعرف شيئًا عن Electron ولا عن الواجهة.
//
// المخزن: <مساحة العمل>/.kunnash/

const fs = require('fs');
const path = require('path');

const ws = require('./workspace');
const {
  DEFAULT_CONNECTION, PRESETS, isLocalUrl,
  testConnection, listModels, getCredits,
} = require('./connection');
const { listLibrary } = require('./library');
const { buildMessageParts } = require('./attachments');
const { runAgent } = require('./agent');
const { userLimits } = require('./agent/loop');

// ---------- الاتصال بالنموذج ----------
function loadConnection() {
  return { ...DEFAULT_CONNECTION, ...ws.loadConnection() };
}
function saveConnection(patch) {
  // نحفظ ما يحرّره المستخدم فقط — لا نثبّت القيم الافتراضية في ملفه
  const { label, baseUrl, model, apiKey, dataPolicy } = patch || {};
  ws.saveConnection({ label, baseUrl, model, apiKey, dataPolicy });
  return true;
}
function connectionStatus() {
  const c = loadConnection();
  return {
    label: c.label,
    model: c.model,
    // الخدمات المحلية (Ollama) لا تحتاج مفتاحًا — جاهزة بالنموذج وحده
    ready: Boolean(c.model && (c.apiKey || isLocalUrl(c.baseUrl))),
  };
}

// ---------- الجلسات ----------
const sessionsFile = () => ws.dataFile('sessions.json');

function loadSessions() {
  if (!ws.getWorkspace()) return [];
  return ws.readJson(sessionsFile(), []);
}
function saveSessions(sessions) { ws.writeJson(sessionsFile(), sessions); }

// حفظ جلسة واحدة بإعادة قراءة الملف أولًا — ضروري لتشغيل عدة محادثات معًا:
// الحفظ من مصفوفة قديمة يمسح ما كتبته محادثة أخرى في نفس اللحظة.
function upsertSession(session) {
  const all = loadSessions().filter(s => s.id !== session.id);
  all.push(session);
  saveSessions(all);
}

function sessionSummaries() {
  return loadSessions().map(s => ({
    id: s.id, title: s.title, model: s.model,
    createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.messages.length,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}
function getSession(id) { return loadSessions().find(s => s.id === id) || null; }
function deleteSession(id) { saveSessions(loadSessions().filter(s => s.id !== id)); return true; }

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
  const root = ws.getWorkspace();
  const connection = connectionStatus();
  if (!root) return { workspace: null, connection, skills: [], recentFiles: [] };

  return {
    workspace: { path: root, name: path.basename(root) },
    connection,
    skills: listLibrary(root).skills,
    recentFiles: scanRecentFiles(root),
  };
}

// ---------- الدردشة ----------
// عقد الأحداث: chat:started · chat:delta · chat:tool · chat:done · chat:error
// كلها تحمل { sessionId, requestId }.
//
// الإلغاء: chat:cancel يجهض التشغيل، والنتيجة chat:done بالنص المتراكم —
// لا chat:error — لئلا يضيع عمل طويل.
const activeRuns = new Map();   // requestId → AbortController

function cancelChat(requestId) {
  const ac = activeRuns.get(requestId);
  if (ac) ac.abort();
  return Boolean(ac);
}

async function chatSend({ sessionId, text, attachments, retry, requestId, skillId }, emit, onPermission, askUser) {
  ws.requireWorkspace();

  const cfg = loadConnection();
  const sessions = loadSessions();
  let session = sessions.find(s => s.id === sessionId);
  const now = Date.now();

  if (!session) {
    session = {
      id: 's' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: text.slice(0, 48) + (text.length > 48 ? '…' : ''),
      model: cfg.model,
      createdAt: now, updatedAt: now,
      messages: [],
    };
    sessions.push(session);
  }
  session.model = cfg.model;
  session.updatedAt = now;

  const attachNames = (attachments || []).map(p => path.basename(p));
  const lastMsg = session.messages[session.messages.length - 1];
  if (!(retry && lastMsg && lastMsg.role === 'user' && lastMsg.text === text)) {
    session.messages.push({ role: 'user', text, ts: now, attachments: attachNames });
  }
  upsertSession(session);

  // requestId يميّز كل تشغيل عن غيره — به تعرف الواجهة أي محادثة يخصّها كل حدث
  const send = (channel, payload) => emit(channel, { sessionId: session.id, requestId, ...payload });
  send('chat:started', { title: session.title, model: cfg.model });

  const ac = new AbortController();
  activeRuns.set(requestId, ac);

  try {
    if (!cfg.model) throw new Error('لم يُحدَّد نموذج بعد — افتح الإعدادات ⚙️ واختر النموذج.');
    if (!cfg.apiKey && !isLocalUrl(cfg.baseUrl)) {
      throw new Error('لم يُدخل مفتاح بعد — افتح الإعدادات ⚙️ واربط حسابك أو ألصق مفتاحًا.');
    }

    // رسالة المستخدم: نص، أو أجزاء إن كانت معها مرفقات
    let userContent = text;
    if (attachments && attachments.length) {
      userContent = [{ type: 'text', text }, ...buildMessageParts(attachments)];
    }

    const profile = ws.loadProfile();
    const result = await runAgent({
      cfg,
      root: ws.requireWorkspace(),
      sessionId: session.id,
      userContent,
      profile,
      limits: userLimits(profile),   // حدود الوقت والكلفة قرار المستخدم من الإعدادات
      forceSkillId: skillId || null,
      onSkillInjected: (id) => send('chat:skill', { id }),
      // جلسة من قبل م٣ بلا نص محفوظ: تاريخها النصي يبذر الذاكرة الجديدة.
      // slice(0,-1) لأن رسالة المستخدم الحالية دُفعت للجلسة قبل قليل.
      seedMessages: session.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.text })),
      onDelta: (chunk) => send('chat:delta', { chunk }),
      onTool: (name, input) => send('chat:tool', { name, input }),
      onPermission: onPermission || (() => 'deny'),   // بلا واجهة: الفشل مغلقًا
      askUser,
      signal: ac.signal,
    });

    session.messages.push({ role: 'assistant', text: result.text, ts: Date.now(), model: cfg.model });
    session.updatedAt = Date.now();
    upsertSession(session);

    send('chat:done', { text: result.text, usage: result.usage, stopReason: result.stopReason });
    return { ok: true, sessionId: session.id };
  } catch (err) {
    upsertSession(session);
    send('chat:error', { message: String(err && err.message || err) });
    return { ok: false, sessionId: session.id, error: String(err && err.message || err) };
  } finally {
    activeRuns.delete(requestId);
  }
}

const permissions = require('./agent/permissions');
const packs = require('./packs');
// القاعدة تخرج ومعها وصفها بلغة صاحبها — الواجهة تعرض ولا تترجم،
// فلا يفترق وصفُ الزر عن وصف القائمة.
const listRules = () => (ws.getWorkspace() ? permissions.load(ws.getWorkspace()) : [])
  .map((r) => ({ ...r, label: permissions.describe(r.tool, r.scope, r.kind) }));
const revokeRule = (tool, scope) => permissions.revoke(ws.requireWorkspace(), tool, scope);

const listPacks = () => packs.list();
const installPack = (id) => packs.install(ws.requireWorkspace(), id);

const loadProfile = () => ws.loadProfile();
const saveProfile = (patch) => { ws.saveProfile(patch); return true; };
const connectionServices = () => ws.connectionServices();

module.exports = {
  PRESETS,
  loadProfile, saveProfile, connectionServices, listRules, revokeRule,
  listPacks, installPack,
  loadConnection, saveConnection, connectionStatus,
  testConnection, listModels, getCredits,
  loadSessions, sessionSummaries, getSession, deleteSession,
  dashboardData, chatSend, cancelChat,
};
