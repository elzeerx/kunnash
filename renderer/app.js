// كُنّاش — منطق الواجهة

const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const emptyEl = $('#empty-state');
const inputEl = $('#input');
const sendBtn = $('#btn-send');
const modelChipEl = $('#model-chip');
const sessionsListEl = $('#sessions-list');

let currentSessionId = null;   // null = محادثة جديدة
let viewToken = 0;             // يتغيّر مع كل تبديل شاشة — يحدد أي تشغيل معروض
let workspace = null;          // { path, name } أو null قبل الاختيار
let connection = null;         // { label, model, ready }

// ---------- أدوات عرض ----------
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMarkdown(text) {
  try { return marked.parse(escapeHtml(text), { breaks: true }); }
  catch { return `<p>${escapeHtml(text)}</p>`; }
}
// تمرير ذكي: يلتصق بالأسفل تلقائيًا أثناء البث، وإذا صعد المستخدم يدويًا
// يحترم مكانه — ويعود للالتصاق عند نزوله لقرب الأسفل (نمط تطبيقات المحادثة)
const chatEl = $('#chat');
let stickToBottom = true;
chatEl.addEventListener('scroll', () => {
  stickToBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
});
function scrollDown(force) {
  if (force || stickToBottom) {
    chatEl.scrollTop = chatEl.scrollHeight;
    stickToBottom = true;
  }
}
function hideEmpty() { emptyEl.style.display = 'none'; }
function showEmpty() { emptyEl.style.display = ''; messagesEl.innerHTML = ''; }

// ---------- مساحة العمل ----------
// بلا مجلد عمل يفتح التطبيق على شاشة الاختيار وحدها: لا محادثة ولا مكتبة ولا
// لوحة بداية — الحالة الفارغة سلوك مقصود لا عطل.
const noWorkspaceEl = $('#no-workspace');
const composerWrapEl = document.querySelector('.composer-wrap');

function applyWorkspace(info) {
  workspace = info || null;
  const has = Boolean(workspace);
  noWorkspaceEl.classList.toggle('hidden', has);
  composerWrapEl.classList.toggle('hidden', !has);
  emptyEl.classList.toggle('hidden', !has);
  $('#btn-library').disabled = !has;
  $('#btn-folder').disabled = !has;
  $('#workspace-name').textContent = has ? workspace.name : 'مجلد العمل';
}

// حالة الاتصال تظهر في موضعين: شريحة في لوحة البداية، ورقاقة النموذج في
// صندوق الكتابة. كلاهما من مصدر واحد فلا يفترقان.
function applyConnection(info) {
  connection = info || null;
  const ready = Boolean(connection && connection.ready);

  const chips = $('#connection-chip');
  chips.innerHTML = '';
  const c = document.createElement('span');
  c.className = 'chip ' + (ready ? 'chip-on' : 'chip-off');
  c.textContent = (ready ? '● ' : '○ ') + (connection ? connection.label : 'بلا اتصال');
  c.title = ready ? connection.model : 'أكمل الاتصال من الإعدادات ⚙️';
  chips.appendChild(c);

  modelChipEl.textContent = ready ? connection.model : 'أكمل الاتصال ⚙️';
  modelChipEl.classList.toggle('unset', !ready);
}

async function chooseWorkspace() {
  const info = await window.kunnash.chooseWorkspace();
  if (!info) return;
  applyWorkspace(info);
  currentSessionId = null;
  showEmpty();
  await renderHome();
  refreshSessions();
  populateActivation();
  inputEl.focus();
}

function addUserMsg(text, attachNames) {
  hideEmpty();
  const div = document.createElement('div');
  div.className = 'msg user';
  if (attachNames && attachNames.length) {
    const at = document.createElement('div');
    at.className = 'msg-attachments';
    for (const n of attachNames) {
      const s = document.createElement('span');
      s.textContent = '📎 ' + n;
      at.appendChild(s);
    }
    div.appendChild(at);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  scrollDown();
}

function addAssistantShell(metaLabel) {
  const div = document.createElement('div');
  div.className = 'msg assistant';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaLabel || '';
  const tools = document.createElement('div');
  tools.className = 'tools';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<span class="typing"><span class="dots">يفكّر</span></span>';
  div.appendChild(meta);
  div.appendChild(tools);
  div.appendChild(bubble);
  messagesEl.appendChild(div);
  scrollDown();
  return { bubble, tools };
}

// ---------- روابط قابلة للنقر في الردود ----------
const FILE_EXTS = 'docx?|xlsx?|pptx?|pdf|html?|md|csv|txt|png|jpe?g|webp|json|heic|mov|mp4';
// جذور المسارات المعروفة — مطلق، أو منزلي، أو نسبي. أسماء المجلدات داخل مساحة
// العمل تختلف من مستخدم لآخر، فالامتداد وحده هو ما يحسم بقيتها (انظر أدناه).
const KNOWN_ROOTS = /^(\/Users\/|~\/|\.{1,2}\/)/;

function looksLikeFilePath(text) {
  const t = text.trim();
  if (!t.includes('/') || t.includes('\n')) return false;
  return KNOWN_ROOTS.test(t) || new RegExp('\\.(' + FILE_EXTS + ')$', 'i').test(t);
}

function makeFileClickable(el, rawPath) {
  el.classList.add('file-link');
  el.title = 'انقر لفتح الملف';
  el.onclick = async (e) => {
    e.stopPropagation();
    const res = await window.kunnash.openFile(rawPath.trim());
    if (!res.ok) {
      el.title = res.message;
      el.classList.add('file-missing');
    }
  };
}

function linkifyBubble(bubble) {
  // 1) الروابط الخارجية تفتح في المتصفح
  bubble.querySelectorAll('a').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); window.kunnash.openLink(a.href); };
  });
  // 2) المسارات داخل باكتيك `...`
  bubble.querySelectorAll('code').forEach((code) => {
    if (code.parentElement.tagName === 'PRE') return;
    const t = code.textContent;
    if (looksLikeFilePath(t)) makeFileClickable(code, t);
  });
  // 3) المسارات في النص العادي بين «...» أو "..."
  const re = new RegExp('[«"]([^«»"\\n]+\\.(?:' + FILE_EXTS + '))[»"]', 'gi');
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('code, pre, a, .file-link')) continue;
    if (re.test(node.textContent)) targets.push(node);
    re.lastIndex = 0;
  }
  for (const textNode of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    const s = textNode.textContent;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s))) {
      frag.appendChild(document.createTextNode(s.slice(last, m.index + 1)));
      const span = document.createElement('span');
      span.textContent = m[1];
      makeFileClickable(span, m[1]);
      frag.appendChild(span);
      frag.appendChild(document.createTextNode(s[m.index + m[0].length - 1]));
      last = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(s.slice(last)));
    textNode.replaceWith(frag);
  }
}

// أزرار النسخ: زر للرد كاملًا + زر لكل كتلة نصية (نسخ نسخة الإيميل وحدها)
function copyFeedback(btn, text) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '✓ نُسخ';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1400);
  });
}

function addCopyControls(msgDiv, rawText) {
  if (!msgDiv || msgDiv.querySelector('.msg-copy')) return;
  const btn = document.createElement('button');
  btn.className = 'msg-copy';
  btn.textContent = '⧉ نسخ الرد';
  btn.title = 'نسخ الرد كاملًا';
  btn.onclick = () => copyFeedback(btn, rawText);
  msgDiv.appendChild(btn);

  msgDiv.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.pre-copy')) return;
    const content = pre.innerText;
    const pb = document.createElement('button');
    pb.className = 'pre-copy';
    pb.textContent = '⧉ نسخ';
    pb.onclick = (e) => { e.stopPropagation(); copyFeedback(pb, content); };
    pre.appendChild(pb);
  });
}

function addError(message, retryPayload) {
  const div = document.createElement('div');
  div.className = 'error-note';
  const span = document.createElement('span');
  span.textContent = '⚠️ ' + message;
  div.appendChild(span);
  if (retryPayload) {
    const btn = document.createElement('button');
    btn.className = 'btn-retry';
    btn.textContent = '↻ إعادة المحاولة';
    btn.onclick = () => { div.remove(); dispatch({ ...retryPayload, retry: true }); };
    div.appendChild(btn);
  }
  messagesEl.appendChild(div);
  scrollDown(true);
}

// أسماء أدوات حلقة م٣ — snake_case. هذه الخريطة هي نقطة اللمس الوحيدة في
// الواجهة عند إضافة أداة جديدة.
function toolLabel(name, input) {
  const file = input && (input.path || input.pattern || input.query || input.url || '');
  const short = typeof file === 'string' ? file.split('/').pop().slice(0, 40) : '';
  const map = {
    read_file: '📖 يقرأ', list_files: '🔍 يبحث عن ملفات', search_files: '🔍 يبحث في المحتوى',
    write_file: '✏️ يكتب ملفًا', edit_file: '✏️ يعدّل', delete_file: '🗑️ ينقل إلى المهملات',
    read_excel: '📊 يقرأ جدول Excel', read_document: '📄 يقرأ مستندًا',
    render_document: '🖨️ يُخرج مستندًا', fetch_url: '🌐 يفتح رابطًا',
    todo_write: '📋 ينظّم المهام', run_agent: '🤖 يشغّل عميلًا جانبيًا',
    list_skills: '⚡ يستعرض المهارات', read_skill: '⚡ يقرأ مهارة',
  };
  if (map[name]) return map[name] + (short ? ': ' + short : '');
  return '🔧 ' + name + (short ? ': ' + short : '');
}

// ---------- الجلسات ----------
async function refreshSessions() {
  const sessions = await window.kunnash.listSessions();
  sessionsListEl.innerHTML = '';
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 's-title';
    title.textContent = s.title;
    title.title = `${s.model || 'بلا نموذج'} · ${s.count} رسالة`;
    const del = document.createElement('button');
    del.className = 's-del';
    del.textContent = '✕';
    del.title = 'حذف المحادثة';
    del.onclick = async (e) => {
      e.stopPropagation();
      await window.kunnash.deleteSession(s.id);
      if (currentSessionId === s.id) { currentSessionId = null; showEmpty(); }
      refreshSessions();
    };
    item.appendChild(title);
    // نقطة نابضة للمحادثات التي ما زالت تعمل في الخلفية
    if ([...runs.values()].some((r) => r.sessionId === s.id)) {
      const dot = document.createElement('span');
      dot.className = 's-run';
      dot.textContent = '●';
      dot.title = 'هذه المحادثة تعمل الآن';
      item.appendChild(dot);
    }
    item.appendChild(del);
    item.onclick = () => openSession(s.id);
    sessionsListEl.appendChild(item);
  }
}

async function openSession(id) {
  const s = await window.kunnash.getSession(id);
  if (!s) return;
  viewToken++;
  detachAllRunDom();   // التشغيلات الأخرى تكمل في الخلفية بلا عرض
  currentSessionId = id;
  hideEmpty();
  messagesEl.innerHTML = '';
  for (const m of s.messages) {
    if (m.role === 'user') addUserMsg(m.text, m.attachments);
    else {
      const { bubble } = addAssistantShell(labelFor(m.model));
      bubble.innerHTML = renderMarkdown(m.text);
      linkifyBubble(bubble);
      addCopyControls(bubble.closest('.msg'), m.text);
    }
  }
  // تشغيل جارٍ لهذه المحادثة؟ أعِد وصله بالشاشة ليكمل البث أمامك
  const live = [...runs.values()].find((r) => r.sessionId === id);
  if (live) {
    live.viewToken = viewToken;
    attachRunDom(live);
  } else {
    // محادثة توقفت قبل اكتمال الرد؟ اعرض إعادة المحاولة بدل إعادة الكتابة
    const last = s.messages[s.messages.length - 1];
    if (last && last.role === 'user') {
      addError('هذه المحادثة توقفت قبل اكتمال الرد.', {
        text: last.text,
        attachments: [],
      });
    }
  }
  refreshSessions();
  updateSendState();
  scrollDown(true);
}

function labelFor(model) {
  return model || (connection && connection.label) || '';
}

function newChat() {
  viewToken++;
  detachAllRunDom();   // ما يعمل الآن يكمل في الخلفية
  currentSessionId = null;
  showEmpty();
  renderHome();
  refreshSessions();
  updateSendState();
  inputEl.focus();
}

// ---------- التنبيهات ----------
// النغمات مركّبة بـ Web Audio لا ملفات صوت — يبقى التطبيق ملفًا واحدًا بلا أصول
// خارجية، ولا يسقط الصوت بصمت لو نُقل المجلد.
//
// تنبيه النظام (notify) مهيّأ لكنه لا يظهر أثناء التطوير: التطبيق يعمل بهوية
// حزمة Electron لا بهويته، وmacOS يرفض تنبيهاتها (UNErrorDomain 1). يعمل من
// تلقاء نفسه فور تغليفه حزمةَ ماك بهوية com.elzeer.kunnash (م٦).
let audioCtx = null;

function tone(freqs, opts = {}) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    // المحرك يبدأ موقوفًا حتى أول تفاعل — نجدول بعد استيقاظه لا قبله، وإلا وقعت
    // أوقات النغمات في الماضي فضاعت أول نغمة بصمت
    const play = () => schedule(freqs, opts);
    if (audioCtx.state === 'suspended') audioCtx.resume().then(play).catch(() => {});
    else play();
  } catch { /* الصوت مكمّل لا جوهري — لا يعطّل شيئًا */ }
}

function schedule(freqs, { type = 'sine', peak = 0.14, step = 0.11, dur = 0.24 } = {}) {
  try {
    freqs.forEach((f, i) => {
      const t0 = audioCtx.currentTime + i * step;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  } catch { /* الصوت مكمّل لا جوهري — لا يعطّل شيئًا */ }
}

// نغمتان متمايزتان: تُميّز بالأذن دون النظر للشاشة
const soundDone = () => tone([659.25, 830.61]);                                        // صاعدة هادئة: انتهت المهمة
const soundAttention = () => tone([880, 660, 880], { type: 'triangle', peak: 0.17, step: 0.13, dur: 0.2 }); // متعرّجة: يحتاجك

function shorten(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function notifyDone(run, finalText) {
  soundDone();
  window.kunnash.notify({
    kind: 'done',
    title: shorten(run.payload.text, 48) || 'انتهت المهمة',
    body: shorten(finalText, 160),
    sessionId: run.sessionId,
  });
}

function notifyError(run, message) {
  soundAttention();
  window.kunnash.notify({
    kind: 'error',
    title: 'توقفت المهمة',
    body: shorten(message, 160),
    sessionId: run.sessionId,
  });
}

// تنبيه من النظام يفتح المحادثة المعنية مباشرة
window.kunnash.onNotifyActivate(({ sessionId }) => {
  if (sessionId && sessionId !== currentSessionId) openSession(sessionId);
});

// ---------- مربع طلب الإذن ----------
const permModal = $('#permission-modal');
const permSummaryEl = $('#perm-summary');
const permDetailsEl = $('#perm-details');
let permCurrentId = null;
const permQueue = [];

function showNextPermission() {
  if (permCurrentId || permQueue.length === 0) return;
  const req = permQueue.shift();
  permCurrentId = req.id;
  permSummaryEl.textContent = req.title || req.summary || `طلب استخدام أداة ${req.toolName}`;
  let details = '';
  if (req.reason) details += req.reason + '\n';
  try {
    const input = req.input || {};
    for (const [k, v] of Object.entries(input)) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      details += `${k}: ${String(val).slice(0, 400)}\n`;
    }
  } catch { /* تجاهل */ }
  permDetailsEl.textContent = details.trim();
  permModal.classList.remove('hidden');
}

function respondPermission(decision) {
  if (!permCurrentId) return;
  window.kunnash.respondPermission(permCurrentId, decision);
  permCurrentId = null;
  permModal.classList.add('hidden');
  setTimeout(showNextPermission, 60);
}

window.kunnash.onPermissionRequest((req) => {
  permQueue.push(req);
  // الإذن يوقف العمل حتى تردّ — ينبّه دائمًا ولو كنت أمام النافذة
  soundAttention();
  window.kunnash.notify({
    kind: 'permission',
    title: 'يحتاج إذنك للمتابعة',
    body: shorten(req.title || req.summary || `أداة ${req.toolName}`, 160),
  });
  showNextPermission();
});

$('#perm-allow').onclick = () => respondPermission('allow');
$('#perm-always').onclick = () => respondPermission('always');
$('#perm-deny').onclick = () => respondPermission('deny');

// ---------- المرفقات ----------
const attachListEl = $('#attach-list');
let pendingFiles = []; // [{ name, path }]

function renderAttachList() {
  attachListEl.innerHTML = '';
  attachListEl.classList.toggle('has-files', pendingFiles.length > 0);
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.innerHTML = '📎 <span class="a-name"></span><button class="a-x" title="إزالة">✕</button>';
    chip.querySelector('.a-name').textContent = f.name;
    chip.querySelector('.a-x').onclick = () => { pendingFiles.splice(i, 1); renderAttachList(); };
    attachListEl.appendChild(chip);
  });
}

function addAttachments(paths) {
  for (const p of paths) {
    if (!p) continue;
    if (pendingFiles.some((f) => f.path === p)) continue;
    if (pendingFiles.length >= 10) break;
    pendingFiles.push({ name: p.split('/').pop(), path: p });
  }
  renderAttachList();
}

$('#btn-attach').onclick = async () => {
  const paths = await window.kunnash.pickFiles();
  addAttachments(paths);
};

const composerEl = document.querySelector('.composer');
['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => {
  e.preventDefault();
  composerEl.classList.add('dragover');
}));
['dragleave', 'dragend'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (e.relatedTarget === null) composerEl.classList.remove('dragover');
}));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  composerEl.classList.remove('dragover');
  const paths = [...(e.dataTransfer.files || [])].map((f) => {
    try { return window.kunnash.pathForFile(f); } catch { return null; }
  });
  addAttachments(paths.filter(Boolean));
});

// ---------- قائمة التفعيل اليدوي ----------
const activationEl = $('#activation-picker');

async function populateActivation() {
  let lib;
  try { lib = await window.kunnash.libraryList(); } catch { return; }
  const current = activationEl.value;
  activationEl.innerHTML = '<option value="">تفعيل تلقائي</option>';
  const gSkills = document.createElement('optgroup');
  gSkills.label = 'تفعيل مهارة';
  for (const s of lib.skills) {
    const o = document.createElement('option');
    o.value = 'skill|' + s.id;
    o.textContent = '⚡ ' + s.name;
    gSkills.appendChild(o);
  }
  const gAgents = document.createElement('optgroup');
  gAgents.label = 'تكليف عميل';
  for (const a of lib.agents) {
    const o = document.createElement('option');
    o.value = 'agent|' + a.id;
    o.textContent = '🤖 ' + a.name;
    gAgents.appendChild(o);
  }
  activationEl.appendChild(gSkills);
  activationEl.appendChild(gAgents);
  if ([...activationEl.options].some((o) => o.value === current)) activationEl.value = current;
  activationEl.classList.toggle('armed', Boolean(activationEl.value));
}

// ---------- لوحة البداية ----------
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const h = diff / 3600000;
  if (h < 1) return 'قبل دقائق';
  if (h < 24) return 'قبل ' + Math.round(h) + ' ساعة';
  const d = Math.round(h / 24);
  if (d === 1) return 'أمس';
  return 'قبل ' + d + ' يوم';
}

async function renderHome() {
  let data;
  try { data = await window.kunnash.dashboardData(); } catch { return; }

  applyWorkspace(data.workspace);
  applyConnection(data.connection);
  if (!data.workspace) return;

  // المهارات كمهام سريعة
  const skillsEl = $('#home-skills');
  skillsEl.innerHTML = '';
  for (const s of data.skills) {
    const b = document.createElement('button');
    b.className = 'home-item';
    b.innerHTML = '<strong></strong><span class="home-item-sub"></span>';
    b.querySelector('strong').textContent = '⚡ ' + s.name;
    b.querySelector('.home-item-sub').textContent = (s.description || '').split('—')[0].slice(0, 70);
    b.onclick = () => runSkill(s);
    skillsEl.appendChild(b);
  }
  if (!data.skills.length) skillsEl.innerHTML = '<div class="home-empty">أنشئ مهاراتك من «🤖 العملاء والمهارات»</div>';

  // آخر الملفات
  const filesEl = $('#home-files');
  filesEl.innerHTML = '';
  for (const f of data.recentFiles) {
    const row = document.createElement('div');
    row.className = 'home-item home-file';
    row.innerHTML = '<div class="home-file-main"><strong></strong><span class="home-item-sub"></span></div><button class="home-open" title="فتح الملف">↗</button>';
    row.querySelector('strong').textContent = f.name;
    row.querySelector('.home-item-sub').textContent = timeAgo(f.mtime) + (f.rel.includes('/') ? ' · ' + f.rel.split('/').slice(0, -1).join('/') : '');
    row.querySelector('.home-file-main').onclick = () => {
      inputEl.value = 'اطّلع على الملف "' + f.rel + '" ولخّص لي أهم ما فيه.';
      autoGrow(); inputEl.focus();
    };
    row.querySelector('.home-open').onclick = async (e) => {
      e.stopPropagation();
      const res = await window.kunnash.openFile(f.rel);
      if (res.ok) return;
      // الرسالة تحل محل السطر الفرعي مؤقتًا، وتبقى في التلميح — نقرةٌ بلا أثر
      // تُقرأ عطلًا في التطبيق، والحارس يملك السبب فلا نبتلعه
      const sub = row.querySelector('.home-item-sub');
      const was = sub.textContent;
      row.title = res.message;
      sub.textContent = '⛔ ' + res.message;
      sub.classList.add('sub-warn');
      setTimeout(() => { sub.textContent = was; sub.classList.remove('sub-warn'); }, 8000);
    };
    filesEl.appendChild(row);
  }
}

function runSkill(skill) {
  newChat();
  sendText('نفّذ المهارة «' + skill.id + '» الآن.');
}

// ---------- الإرسال ----------
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || runForCurrentView()) return;
  inputEl.value = '';
  autoGrow();
  sendText(text);
}

async function sendText(text) {
  if (!text || runForCurrentView()) return;

  // تفعيل يدوي لمهارة أو عميل — يوجَّه الطلب صراحة.
  // في م٤ يصير هذا حقنًا حقيقيًا لنص المهارة كرسالة نظام لا مجرد صياغة للطلب.
  const act = activationEl.value;
  if (act) {
    const [kind, id] = act.split('|');
    text = kind === 'skill'
      ? 'استخدم المهارة «' + id + '» لتنفيذ الطلب التالي:\n\n' + text
      : 'كلّف العميل الجانبي «' + id + '» بالطلب التالي وقدّم لي نتيجته:\n\n' + text;
  }

  const attachments = pendingFiles.map((f) => f.path);
  addUserMsg(text, pendingFiles.map((f) => f.name));
  pendingFiles = [];
  renderAttachList();

  await dispatch({ text, attachments });
}

// ---------- تشغيل عدة محادثات في وقت واحد ----------
// كل إرسال يصير «تشغيلًا» له معرّف، ويستمر في الخلفية حتى لو انتقلت
// لمحادثة أخرى أو فتحت جديدة. الشاشة تعرض تشغيل المحادثة المفتوحة فقط،
// وviewToken يحدد أي تشغيل ما زالت عناصره معروضة على الشاشة الحالية.
const runs = new Map();
let runCounter = 0;

function runForCurrentView() {
  for (const run of runs.values()) {
    if (run.sessionId ? run.sessionId === currentSessionId : run.viewToken === viewToken) return run;
  }
  return null;
}

function updateSendState() {
  const busy = Boolean(runForCurrentView());
  sendBtn.disabled = busy;
  sendBtn.textContent = busy ? 'يعمل…' : 'إرسال';
}

// يربط تشغيلًا بالشاشة الحالية ويعرض ما تراكم فيه حتى الآن
function attachRunDom(run) {
  const shell = addAssistantShell(labelFor(run.model));
  run.els = shell;
  if (run.text) shell.bubble.textContent = run.text;
  for (const label of run.tools) {
    const chip = document.createElement('span');
    chip.className = 'tool-chip';
    chip.textContent = label;
    shell.tools.appendChild(chip);
  }
  scrollDown();
}

function detachAllRunDom() {
  for (const run of runs.values()) run.els = null;
}

async function dispatch(payload) {
  const requestId = 'r' + (++runCounter) + Date.now().toString(36);
  const run = {
    requestId,
    sessionId: currentSessionId,
    viewToken,
    payload,
    model: connection ? connection.model : '',
    text: '',
    tools: [],
    els: null,
  };
  runs.set(requestId, run);
  attachRunDom(run);
  updateSendState();

  await window.kunnash.sendMessage({ sessionId: currentSessionId, requestId, ...payload });
}

function finishRun(run) {
  runs.delete(run.requestId);
  updateSendState();
  refreshSessions();
  if (run.els) { scrollDown(); inputEl.focus(); }
}

// أحداث البث من العملية الرئيسية — كل حدث يحمل requestId فيصل لمحادثته
window.kunnash.onChatEvent('chat:started', ({ requestId, sessionId, model }) => {
  const run = runs.get(requestId);
  if (!run) return;
  run.sessionId = sessionId;
  if (model) run.model = model;
  // لو ما زلنا على نفس الشاشة التي أُرسل منها، تتبنّى هذه الشاشة الجلسة الجديدة
  if (run.viewToken === viewToken && !currentSessionId) currentSessionId = sessionId;
  refreshSessions();
});

window.kunnash.onChatEvent('chat:delta', ({ requestId, chunk }) => {
  const run = runs.get(requestId);
  if (!run) return;
  run.text += chunk;
  // أثناء البث نعرض نصًا خامًا للسرعة، وعند الاكتمال نعيد العرض كماركداون
  if (run.els) { run.els.bubble.textContent = run.text; scrollDown(); }
});

window.kunnash.onChatEvent('chat:tool', ({ requestId, name, input }) => {
  const run = runs.get(requestId);
  if (!run) return;
  const label = toolLabel(name, input);
  run.tools.push(label);
  if (run.els) {
    const chip = document.createElement('span');
    chip.className = 'tool-chip';
    chip.textContent = label;
    run.els.tools.appendChild(chip);
    scrollDown();
  }
});

window.kunnash.onChatEvent('chat:done', ({ requestId, text }) => {
  const run = runs.get(requestId);
  if (!run) return;
  const finalText = text || run.text || '';
  if (run.els) {
    run.els.bubble.innerHTML = renderMarkdown(finalText);
    linkifyBubble(run.els.bubble);
    addCopyControls(run.els.bubble.closest('.msg'), finalText);
  }
  notifyDone(run, finalText);
  finishRun(run);
});

window.kunnash.onChatEvent('chat:error', ({ requestId, message }) => {
  const run = runs.get(requestId);
  if (!run) return;
  // إن كانت المحادثة معروضة نعرض الخطأ فورًا، وإلا يظهر زر إعادة المحاولة عند فتحها
  if (run.els) {
    if (!run.text) run.els.bubble.closest('.msg').remove();
    addError(message, { ...run.payload, retry: true });
  }
  notifyError(run, message);
  finishRun(run);
});

// ---------- الاتصال بالنموذج ----------
const settingsModal = $('#settings-modal');
const connStatusEl = $('#conn-status');

async function openSettings() {
  const c = await window.kunnash.getConnection();
  $('#conn-label').value = c.label || '';
  $('#conn-url').value = c.baseUrl || '';
  $('#conn-model').value = c.model || '';
  // المفتاح لا يعبر الجسر — الحقل فارغ، ونائبه يخبر أنه محفوظ
  $('#conn-key').value = '';
  $('#conn-key').placeholder = c.hasKey ? '•••••••• محفوظ — اترك الحقل فارغًا لإبقائه' : 'sk-...';
  connStatusEl.className = 'test-status';
  connStatusEl.textContent = '';
  settingsModal.classList.remove('hidden');
}

// المفتاح يُرسل فقط إن كتب المستخدم واحدًا جديدًا: الحقل الفارغ يعني «لا تغيّره»
function connectionPatch() {
  const key = $('#conn-key').value.replace(/\s+/g, '');
  return {
    label: $('#conn-label').value.trim(),
    baseUrl: $('#conn-url').value.replace(/\s+/g, ''),
    model: $('#conn-model').value.trim(),
    ...(key ? { apiKey: key } : {}),
  };
}

async function saveSettings(keepOpen) {
  await window.kunnash.saveConnection(connectionPatch());
  const c = await window.kunnash.getConnection();
  applyConnection({ label: c.label, model: c.model, ready: Boolean(c.hasKey && c.model) });
  if (keepOpen !== true) settingsModal.classList.add('hidden');
}

async function testConnection() {
  connStatusEl.className = 'test-status';
  connStatusEl.textContent = 'يجرّب الاتصال…';
  await saveSettings(true);   // نختبر ما هو مكتوب فعلًا لا ما كان محفوظًا
  const res = await window.kunnash.testConnection();
  if (res.ok) { connStatusEl.classList.add('ok'); connStatusEl.textContent = '✅ يعمل — رد النموذج: ' + res.reply; }
  else { connStatusEl.classList.add('fail'); connStatusEl.textContent = '⛔ ' + res.error; }
}

// ---------- مكتبة العملاء والمهارات ----------
const libraryModal = $('#library-modal');
const libAgentsEl = $('#lib-agents');
const libSkillsEl = $('#lib-skills');
const libForm = $('#lib-editor-form');
const libEmpty = $('#lib-editor-empty');
const libIdEl = $('#lib-id');
const libContentEl = $('#lib-content');
const libStatusEl = $('#lib-status');
const libBadgeEl = $('#lib-type-badge');

let libCurrent = null; // { type, id, isNew }

const TYPE_LABELS = { agent: 'عميل جانبي', skill: 'مهارة' };

async function refreshLibrary() {
  const { agents, skills } = await window.kunnash.libraryList();
  const render = (el, items) => {
    el.innerHTML = '';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'lib-item' + (libCurrent && !libCurrent.isNew && libCurrent.type === item.type && libCurrent.id === item.id ? ' active' : '');
      btn.innerHTML = `<strong></strong><span class="lib-item-desc"></span>`;
      btn.querySelector('strong').textContent = item.name;
      btn.querySelector('.lib-item-desc').textContent = item.description || '';
      btn.onclick = () => openLibItem(item.type, item.id);
      el.appendChild(btn);
    }
  };
  render(libAgentsEl, agents);
  render(libSkillsEl, skills);
}

async function openLibItem(type, id) {
  const content = await window.kunnash.libraryRead(type, id);
  libCurrent = { type, id, isNew: false };
  libIdEl.value = id;
  libIdEl.disabled = true;
  libContentEl.value = content;
  libBadgeEl.textContent = TYPE_LABELS[type];
  libStatusEl.textContent = '';
  libEmpty.classList.add('hidden');
  libForm.classList.remove('hidden');
  refreshLibrary();
}

async function newLibItem(type) {
  libCurrent = { type, id: '', isNew: true };
  libIdEl.value = '';
  libIdEl.disabled = false;
  libContentEl.value = await window.kunnash.libraryTemplate(type, 'new-item');
  libBadgeEl.textContent = TYPE_LABELS[type] + ' — جديد';
  libStatusEl.textContent = '';
  libEmpty.classList.add('hidden');
  libForm.classList.remove('hidden');
  refreshLibrary();
  libIdEl.focus();
}

async function saveLibItem() {
  if (!libCurrent) return;
  const id = libIdEl.value.trim();
  libStatusEl.textContent = '';
  libStatusEl.classList.remove('fail');
  try {
    if (!id) throw new Error('اكتب المعرّف أولًا — هو اسم مجلد المهارة (مثل: weekly-report أو «تقرير-الأسبوع»)');
    let content = libContentEl.value;
    if (libCurrent.isNew) content = content.replace(/^name: .*$/m, 'name: ' + id);
    await window.kunnash.librarySave(libCurrent.type, id, content);
    libCurrent = { type: libCurrent.type, id, isNew: false };
    libIdEl.disabled = true;
    libContentEl.value = content;
    libStatusEl.textContent = '✅ حُفظ';
    refreshLibrary();
    populateActivation();
    renderHome();
  } catch (err) {
    libStatusEl.classList.add('fail');
    libStatusEl.textContent = '⛔ ' + String(err && err.message || err).replace(/^.*Error: /, '');
  }
}

async function deleteLibItem() {
  if (!libCurrent || libCurrent.isNew) { closeLibEditor(); return; }
  const yes = confirm(`متأكد من حذف «${libCurrent.id}»؟ سيُحذف الملف من .kunnash نهائيًا.`);
  if (!yes) return;
  await window.kunnash.libraryDelete(libCurrent.type, libCurrent.id);
  closeLibEditor();
  refreshLibrary();
  populateActivation();
  renderHome();
}

function closeLibEditor() {
  libCurrent = null;
  libForm.classList.add('hidden');
  libEmpty.classList.remove('hidden');
}

// ---------- ربط الأحداث ----------
sendBtn.onclick = sendMessage;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
inputEl.addEventListener('input', autoGrow);

$('#btn-new').onclick = newChat;
$('#btn-folder').onclick = () => window.kunnash.openFolder();
$('#btn-library').onclick = () => { refreshLibrary(); closeLibEditor(); libraryModal.classList.remove('hidden'); };
$('#btn-close-library').onclick = () => libraryModal.classList.add('hidden');
libraryModal.addEventListener('click', (e) => { if (e.target === libraryModal) libraryModal.classList.add('hidden'); });
document.querySelectorAll('.lib-new').forEach((b) => { b.onclick = () => newLibItem(b.dataset.type); });
$('#lib-save').onclick = saveLibItem;
$('#lib-delete').onclick = deleteLibItem;
$('#btn-settings').onclick = openSettings;
$('#btn-close-settings').onclick = () => settingsModal.classList.add('hidden');
$('#btn-save-settings').onclick = saveSettings;
$('#btn-test-conn').onclick = testConnection;
modelChipEl.onclick = openSettings;
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });

$('#btn-choose-workspace').onclick = chooseWorkspace;

activationEl.addEventListener('change', () => {
  activationEl.classList.toggle('armed', Boolean(activationEl.value));
});

// البداية
(async () => {
  applyWorkspace(await window.kunnash.getWorkspace());
  refreshSessions();
  renderHome();
  populateActivation();
  updateSendState();
  if (workspace) inputEl.focus();
})();
