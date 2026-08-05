const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kunnash', {
  // مساحة العمل
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),

  // الاتصال بالنموذج
  getConnection: () => ipcRenderer.invoke('connection:get'),
  saveConnection: (patch) => ipcRenderer.invoke('connection:save', patch),
  testConnection: () => ipcRenderer.invoke('connection:test'),
  getPresets: () => ipcRenderer.invoke('connection:presets'),
  linkOpenRouter: () => ipcRenderer.invoke('connection:link'),
  listModels: () => ipcRenderer.invoke('connection:models'),
  getCredits: () => ipcRenderer.invoke('connection:credits'),

  // مكتبة العملاء والمهارات
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryRead: (type, id) => ipcRenderer.invoke('library:read', { type, id }),
  librarySave: (type, id, content) => ipcRenderer.invoke('library:save', { type, id, content }),
  libraryDelete: (type, id) => ipcRenderer.invoke('library:delete', { type, id }),
  libraryTemplate: (type, id) => ipcRenderer.invoke('library:template', { type, id }),

  // الجلسات
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),

  // الدردشة
  sendMessage: (payload) => ipcRenderer.invoke('chat:send', payload),
  onChatEvent: (channel, cb) => {
    const valid = ['chat:started', 'chat:delta', 'chat:tool', 'chat:done', 'chat:error'];
    if (!valid.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },

  // الأذونات
  onPermissionRequest: (cb) => ipcRenderer.on('permission:request', (_e, payload) => cb(payload)),
  respondPermission: (id, decision) => ipcRenderer.send('permission:respond', { id, decision }),

  // التنبيهات
  notify: (payload) => ipcRenderer.send('notify:show', payload),
  onNotifyActivate: (cb) => ipcRenderer.on('notify:activate', (_e, payload) => cb(payload)),

  // المرفقات
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pathForFile: (file) => webUtils.getPathForFile(file),

  // متفرقات
  openFolder: () => ipcRenderer.invoke('folder:open'),
  openFile: (rel) => ipcRenderer.invoke('file:open', rel),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  dashboardData: () => ipcRenderer.invoke('dashboard:data'),
});
