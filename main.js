// كُنّاش — العملية الرئيسية (تطبيق الماك)
// المنطق (الجلسات، الدردشة، الإعدادات) في lib/core.js، والمخزن في
// <مساحة العمل>/.kunnash/ — وهذا الملف نقلٌ وواجهةُ نظام فقط.

const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');

const core = require('./lib/core');
const ws = require('./lib/workspace');
const { resolveInWorkspace, forgetRoot } = require('./lib/paths');
const { listLibrary, readItem, saveItem, deleteItem, templateFor } = require('./lib/library');

const APP_NAME = 'كُنّاش';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#FAF8F4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setMenuBarVisibility(false);

  // الروابط الخارجية تفتح في المتصفح، والنافذة لا تغادر الواجهة أبدًا
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

app.setName(APP_NAME);

app.whenReady().then(() => {
  ws.init(app.getPath('userData'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function requireRoot() { return ws.requireWorkspace(); }

// ---------- IPC: مساحة العمل ----------
ipcMain.handle('workspace:get', () => {
  const root = ws.getWorkspace();
  return root ? { path: root, name: path.basename(root) } : null;
});
ipcMain.handle('workspace:choose', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'اختر مجلد العمل',
    message: 'كُنّاش يشتغل على هذا المجلد وما فيه',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  forgetRoot();   // الجذر المحلول مخزَّن — تبديل المساحة يبطله
  const root = ws.setWorkspace(r.filePaths[0]);
  return { path: root, name: path.basename(root) };
});

// ---------- IPC: مكتبة العملاء والمهارات ----------
// القراءة بلا مساحة عمل ليست خطأ — الواجهة تسأل عنها قبل الاختيار
ipcMain.handle('library:list', () => {
  const root = ws.getWorkspace();
  return root ? listLibrary(root) : { agents: [], skills: [] };
});
ipcMain.handle('library:read', (_e, { type, id }) => readItem(requireRoot(), type, id));
ipcMain.handle('library:save', (_e, { type, id, content }) => saveItem(requireRoot(), type, id, content));
ipcMain.handle('library:delete', (_e, { type, id }) => deleteItem(requireRoot(), type, id));
ipcMain.handle('library:template', (_e, { type, id }) => templateFor(type, id));

// ---------- IPC: الاتصال بالنموذج ----------
ipcMain.handle('connection:get', () => {
  // المفتاح لا يعبر الجسر: الواجهة تعرف أنه محفوظ ولا تعرف قيمته
  const { label, baseUrl, model, apiKey } = core.loadConnection();
  return { label, baseUrl, model, hasKey: Boolean(apiKey) };
});
ipcMain.handle('connection:save', (_e, patch) => core.saveConnection(patch));
ipcMain.handle('connection:test', async () => {
  const cfg = core.loadConnection();
  if (!cfg.apiKey) return { ok: false, error: 'أدخل المفتاح أولًا ثم احفظ' };
  if (!cfg.model) return { ok: false, error: 'اكتب اسم النموذج أولًا ثم احفظ' };
  try {
    const reply = await core.testConnection(cfg);
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ---------- IPC: جلسات ----------
ipcMain.handle('sessions:list', () => core.sessionSummaries());
ipcMain.handle('sessions:get', (_e, id) => core.getSession(id));
ipcMain.handle('sessions:delete', (_e, id) => core.deleteSession(id));

// ---------- IPC: ملفات وروابط ----------
ipcMain.handle('folder:open', () => shell.openPath(requireRoot()));
// يرجع سبب المنع لا مجرد false: النقرة التي لا يحدث بعدها شيء تُقرأ عطلًا،
// والحارس يملك رسالة تشرح — فلا نبتلعها
ipcMain.handle('file:open', async (_e, rel) => {
  try {
    const { abs } = resolveInWorkspace(requireRoot(), rel, { mustExist: true });
    const err = await shell.openPath(abs);
    return err ? { ok: false, code: 'OPEN_FAILED', message: err } : { ok: true };
  } catch (err) {
    return { ok: false, code: err.code || 'ERROR', message: err.message };
  }
});
ipcMain.handle('link:open', (_e, url) => {
  if (/^https?:\/\//.test(String(url))) return shell.openExternal(url);
  return false;
});
ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'إرفاق ملفات للمحادثة',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

// ---------- IPC: لوحة البداية ----------
ipcMain.handle('dashboard:data', () => core.dashboardData());

// ---------- IPC: التنبيهات ----------
// النغمة تُصدر في الواجهة (تتميز حسب نوع الحدث)، وهنا تنبيه النظام فقط.
// الاكتمال لا يُزعجك وأنت أمام النافذة — الصوت يكفي؛ أما طلب الإذن فيوقف
// العمل حتى تردّ، فيُعلن دائمًا مع قفزة في الدوك.
ipcMain.on('notify:show', (_e, { kind, title, body, sessionId } = {}) => {
  if (!Notification.isSupported()) return;
  const focused = !!(win && !win.isDestroyed() && win.isFocused());
  if (kind === 'done' && focused) return;

  const n = new Notification({
    title: String(title || APP_NAME).slice(0, 120),
    body: String(body || '').slice(0, 300),
    silent: true,
  });
  n.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (sessionId) win.webContents.send('notify:activate', { sessionId });
  });
  n.show();

  if (kind !== 'done' && process.platform === 'darwin' && app.dock) {
    try { app.dock.bounce('informational'); } catch { /* القفز تجميلي */ }
  }
});

// ---------- IPC: الدردشة والأذونات ----------
// طلبات إذن معلّقة: id → resolve، تُحل عند رد المستخدم من المربع.
// الطابور والمربع مبنيان ويعملان — تستهلكهما بوابة الإذن في م٤ كما هما.
const pendingPermissions = new Map();

ipcMain.on('permission:respond', (_e, { id, decision }) => {
  const resolve = pendingPermissions.get(id);
  if (resolve) {
    pendingPermissions.delete(id);
    resolve(decision);
  }
});

function askPermission(request) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve('deny'); return; }
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    pendingPermissions.set(id, resolve);
    win.webContents.send('permission:request', { id, ...request });
  });
}

ipcMain.handle('chat:send', async (_e, params) => {
  const emit = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  return core.chatSend(params, emit, askPermission);
});
