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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// كان الترميز يسبق التحليل (escapeHtml ثم marked)، فيصير «> نص» إلى
// «&gt; نص» فلا يراه المحلل اقتباسًا — ولهذا كانت مسودات البريد تظهر بعلامات
// «>» عارية بدل بطاقة أنيقة. الصواب: نحلّل الماركداون أولًا ثم **ننقّي
// الشجرة الناتجة** بقائمة سماح، فالتنسيق يعمل والحقن مسدود.
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'STRONG', 'EM', 'DEL', 'CODE', 'PRE', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
]);
const ALLOWED_ATTRS = { A: ['href', 'title'], TD: ['align'], TH: ['align'], CODE: ['class'] };
// class على code وحدها، وبشرط أن تكون اسم لغة — لا صنفًا حرًّا. نحتاجها
// لنعرض «bash» أو «json» في ترويسة الكتلة: المستخدم العادي لا يميّز أمرًا
// يُلصق في الطرفية من بيانات إلا بالاسم.
const LANG_CLASS = /^language-[\w+#.-]{1,24}$/;

function sanitizeTree(root) {
  for (const el of [...root.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);      // نُبقي النص ونُسقط الوسم
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (!(ALLOWED_ATTRS[el.tagName] || []).includes(name)) {
        el.removeAttribute(attr.name);       // يشمل كل on* وstyle
      } else if (name === 'class' && !LANG_CLASS.test(attr.value)) {
        el.removeAttribute(attr.name);       // صنف ليس اسم لغة: لا يمرّ
      }
    }
    const href = el.getAttribute('href');
    if (href && !/^(https?:|mailto:)/i.test(href.trim())) el.removeAttribute('href');
  }
  return root;
}

function renderMarkdown(text) {
  const box = document.createElement('div');
  try {
    box.innerHTML = marked.parse(String(text), { breaks: true, gfm: true });
    sanitizeTree(box);
    // لكل فقرة اتجاهها من نصّها هي (bidi.js): ردٌّ واحد قد يحمل فقرة عربية
    // وأخرى إنجليزية وكتلة شيفرة — واتجاهٌ واحد مفروض يُفسد اثنتين منها.
    bidi.applyDir(box);
  } catch {
    box.textContent = String(text);
  }
  return box.innerHTML;
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
const noWorkspaceEl = $('#onboarding');
const composerWrapEl = document.querySelector('.composer-wrap');

let onboarding = false;

function applyWorkspace(info) {
  workspace = info || null;
  const has = Boolean(workspace);
  const showChat = has && !onboarding;
  noWorkspaceEl.classList.toggle('hidden', showChat);
  composerWrapEl.classList.toggle('hidden', !showChat);
  emptyEl.classList.toggle('hidden', !showChat);
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

function applyGreeting(name) {
  $('#greeting').textContent = name ? `حيّاك الله يا ${name}` : 'حيّاك الله';
}

async function afterWorkspaceChange(info) {
  applyWorkspace(info);
  currentSessionId = null;
  showEmpty();
  await renderHome();
  refreshSessions();
  populateActivation();
  if (info) inputEl.focus();
}

// ---------- أول تشغيل ----------
// أربع خطوات لا شاشة واحدة: الاسم، فالمجلد، فالاتصال، فحزمة مهارات جاهزة —
// ثم أول طلب مقترح. الهدف المقاس: من تثبيت نظيف إلى أول مخرَج حقيقي في أقل
// من خمس دقائق، فكل خطوة تُتخطّى إلا التي لا يعمل التطبيق بدونها.
const OB_STEPS = [
  { id: 'name', label: 'اسمك', skippable: true },
  { id: 'workspace', label: 'مجلد العمل', skippable: false },
  { id: 'connection', label: 'النموذج', skippable: false },
  { id: 'pack', label: 'مهاراتك', skippable: true },
];
let obIndex = 0;

function renderObSteps() {
  const box = $('#ob-steps');
  box.innerHTML = '';
  OB_STEPS.forEach((s, i) => {
    const el = document.createElement('span');
    el.className = 'ob-step' + (i === obIndex ? ' active' : (i < obIndex ? ' done' : ''));
    el.textContent = `${i + 1}. ${s.label}`;
    box.appendChild(el);
  });
}

async function renderOnboarding() {
  const step = OB_STEPS[obIndex];
  const body = $('#ob-body');
  const next = $('#ob-next');
  const skip = $('#ob-skip');
  body.innerHTML = '';
  renderObSteps();
  skip.classList.toggle('hidden', !step.skippable);
  next.classList.remove('hidden');

  if (step.id === 'name') {
    $('#ob-lede').textContent = 'بمَ تحب أن يناديك؟ (يظهر في الترحيب فقط، ويبقى على جهازك)';
    const input = document.createElement('input');
    input.className = 'ob-input';
    input.placeholder = 'مثال: نوّاف';
    input.value = (await window.kunnash.getProfile()).name || '';
    input.onkeydown = (e) => { if (e.key === 'Enter') next.click(); };
    body.appendChild(input);
    next.textContent = 'التالي';
    next.onclick = async () => {
      await window.kunnash.saveProfile({ name: input.value.trim() });
      applyGreeting(input.value.trim());
      obIndex++; renderOnboarding();
    };
    setTimeout(() => input.focus(), 50);
    return;
  }

  if (step.id === 'workspace') {
    $('#ob-lede').textContent = 'كُنّاش يشتغل على مجلد تختاره أنت — ملفاتك تبقى مكانها، وهو يقرأ منها ويكتب فيها.';
    const current = await window.kunnash.getWorkspace();
    if (current) {
      const ok = document.createElement('div');
      ok.className = 'ob-ok';
      ok.textContent = `✓ ${current.name}`;
      body.appendChild(ok);
    }
    const pick = document.createElement('button');
    pick.className = 'btn-ghost-dark ob-pick';
    pick.textContent = current ? 'اختر مجلدًا آخر' : '📁 اختر مجلد العمل';
    pick.onclick = async () => {
      const info = await window.kunnash.chooseWorkspace();
      if (info) { await afterWorkspaceChange(info); renderOnboarding(); }
    };
    body.appendChild(pick);
    next.textContent = 'التالي';
    next.disabled = !current;
    next.onclick = () => { obIndex++; renderOnboarding(); };
    return;
  }

  if (step.id === 'connection') {
    $('#ob-lede').textContent = 'اربط النموذج الذي تريد — بضغطة عبر OpenRouter، أو بمفتاح خدمة تملكها.';
    const c = await window.kunnash.getConnection();
    const ready = Boolean(c.model && c.hasKey);
    if (ready) {
      const ok = document.createElement('div');
      ok.className = 'ob-ok';
      ok.textContent = `✓ ${c.label} · ${c.model}`;
      body.appendChild(ok);
    }
    const open = document.createElement('button');
    open.className = 'btn-ghost-dark ob-pick';
    open.textContent = ready ? 'تعديل الاتصال' : '⚙️ افتح الإعدادات واربط';
    open.onclick = async () => { await openSettings(); };
    body.appendChild(open);
    next.textContent = 'التالي';
    next.disabled = !ready;
    next.onclick = () => { obIndex++; renderOnboarding(); };
    return;
  }

  // حزم المهن
  $('#ob-lede').textContent = 'ابدأ بمهارات جاهزة بدل صفحة فارغة — تُنسخ إلى مجلدك فتصير ملكك، تعدّلها وتحذفها كما تشاء.';
  const packs = await window.kunnash.listPacks();
  const list = document.createElement('div');
  list.className = 'ob-packs';
  for (const p of packs) {
    const card = document.createElement('button');
    card.className = 'ob-pack';
    card.innerHTML = '<strong></strong><span></span><i></i>';
    card.querySelector('strong').textContent = p.label;
    card.querySelector('span').textContent = p.description;
    card.querySelector('i').textContent = `${p.skills.length} مهارات`;
    card.onclick = async () => {
      const res = await window.kunnash.installPack(p.id);
      card.classList.add('installed');
      card.querySelector('i').textContent = res.installed.length
        ? `✓ ثُبّتت ${res.installed.length} مهارات`
        : '✓ مثبّتة سلفًا';
      await renderHome();
      populateActivation();
    };
    list.appendChild(card);
  }
  body.appendChild(list);
  next.textContent = 'ابدأ العمل';
  next.disabled = false;
  next.onclick = async () => {
    await window.kunnash.saveProfile({ onboarded: 'true' });
    // العلم أولًا: applyWorkspace (يستدعيه renderHome) يقرأ onboarding ليقرر
    // ماذا يُظهر — فلو بقي مرفوعًا أعاد إخفاء المحادثة فور إظهارها.
    onboarding = false;
    applyWorkspace(await window.kunnash.getWorkspace());
    await renderHome();
    inputEl.focus();
  };
}

$('#ob-skip').onclick = () => { obIndex++; renderOnboarding(); };

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
  bidi.setDir(bubble, text);        // «React هو مكتبة…» تبقى يمينية
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

// كل كتلة يُرجَّح أن يأخذها المستخدم كما هي — شيفرة، أو مسودة رسالة في
// اقتباس، أو جدول — تحمل زر نسخها الخاص. المسودة تُنسخ بلا علامات الاقتباس.
function addCopyControls(msgDiv, rawText) {
  if (!msgDiv || msgDiv.querySelector('.msg-copy')) return;
  const btn = document.createElement('button');
  btn.className = 'msg-copy';
  btn.textContent = '⧉ نسخ الرد';
  btn.title = 'نسخ الرد كاملًا';
  btn.onclick = () => copyFeedback(btn, rawText);
  msgDiv.appendChild(btn);

  // الشيفرة تُغلَّف بترويسة تحمل اسم اللغة وزر النسخ — لا زرًّا عائمًا فوقها
  for (const pre of msgDiv.querySelectorAll('pre')) {
    if (pre.closest('.code-block')) continue;
    const content = pre.innerText.trim();
    if (!content) continue;

    const code = pre.querySelector('code');
    const cls = (code && code.getAttribute('class')) || '';
    const lang = cls.startsWith('language-') ? cls.slice(9) : '';

    const fig = document.createElement('figure');
    fig.className = 'code-block';
    const cap = document.createElement('figcaption');
    const name = document.createElement('span');
    name.className = 'lang bidi-isolate';
    name.setAttribute('dir', 'ltr');
    name.textContent = lang || 'نص';
    const b = document.createElement('button');
    b.className = 'block-copy';
    b.textContent = '⧉ نسخ';
    b.onclick = (e) => { e.stopPropagation(); copyFeedback(b, content); };
    cap.appendChild(name);
    cap.appendChild(b);

    pre.replaceWith(fig);
    fig.appendChild(cap);
    fig.appendChild(pre);
  }

  // المسودات والجداول: زرٌّ يظهر عند المرور، بلا تغيير بنيتها
  for (const block of msgDiv.querySelectorAll('blockquote, table')) {
    if (block.querySelector('.block-copy')) continue;
    const content = block.innerText.trim();
    if (!content) continue;
    block.classList.add('copyable');
    const b = document.createElement('button');
    b.className = 'block-copy';
    b.textContent = '⧉ نسخ';
    b.title = block.tagName === 'BLOCKQUOTE' ? 'نسخ المسودة وحدها' : 'نسخ هذه الكتلة';
    b.onclick = (e) => { e.stopPropagation(); copyFeedback(b, content); };
    block.appendChild(b);
  }
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
  // ما ستحفظه «دائمًا» بالضبط — فلا يوقّع المستخدم على بياض
  const scopeEl = $('#perm-scope');
  if (req.alwaysScope) {
    scopeEl.textContent = `«السماح دائمًا» يحفظ قاعدة: ${req.alwaysScope}`;
    scopeEl.classList.remove('hidden');
  } else {
    scopeEl.textContent = '«السماح دائمًا» لهذا التشغيل وحده';
    scopeEl.classList.remove('hidden');
  }
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

// ---------- سؤال النموذج للمستخدم ----------
// بطاقة داخل المحادثة لا مربع حاجب: السؤال جزء من سياق الكلام، والتشغيل
// موقوف حتى يُجاب. وخيار «احفظه دائمًا» هو ما تُبنى به ذاكرة كُنّاش عن صاحبه.
window.kunnash.onAskRequest((req) => {
  soundAttention();
  hideEmpty();

  const card = document.createElement('div');
  card.className = 'ask-card';

  const q = document.createElement('div');
  q.className = 'ask-question';
  q.textContent = req.question;
  card.appendChild(q);

  let remember = false;
  let rememberRow = null;
  if (req.rememberKey) {
    rememberRow = document.createElement('label');
    rememberRow.className = 'ask-remember';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = () => { remember = cb.checked; };
    const txt = document.createElement('span');
    txt.textContent = `احفظ اختياري لـ«${req.rememberKey}» فلا تسألني مرة أخرى`;
    rememberRow.appendChild(cb);
    rememberRow.appendChild(txt);
  }

  const opts = document.createElement('div');
  opts.className = 'ask-options';
  const answer = (value) => {
    window.kunnash.respondAsk(req.id, value, remember);
    card.classList.add('answered');
    opts.innerHTML = '';
    if (rememberRow) rememberRow.remove();
    const chosen = document.createElement('div');
    chosen.className = 'ask-chosen';
    chosen.textContent = value ? `✓ ${value}${remember ? ' · محفوظ' : ''}` : '✕ بلا اختيار';
    card.appendChild(chosen);
  };
  for (const o of req.options) {
    const b = document.createElement('button');
    b.className = 'ask-option';
    b.textContent = o;
    b.onclick = () => answer(o);
    opts.appendChild(b);
  }
  const skip = document.createElement('button');
  skip.className = 'ask-skip';
  skip.textContent = 'اختر أنت';
  skip.onclick = () => answer(null);
  opts.appendChild(skip);

  card.appendChild(opts);
  if (rememberRow) card.appendChild(rememberRow);
  messagesEl.appendChild(card);
  scrollDown(true);
});

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
      // يُرفق الملف نفسه لا مساره: النموذج في هذه المرحلة يرى المرفقات فقط
      addAttachments([workspace.path + '/' + f.rel]);
      if (!inputEl.value.trim()) inputEl.value = 'لخّص لي أهم ما في الملف المرفق.';
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
  // sendText يلتقط قيمة التفعيل في أول سطر متزامن — فالضبط بعدها فورًا آمن
  activationEl.value = 'skill|' + skill.id;
  const run = sendText('نفّذ هذه المهارة الآن.');
  activationEl.value = '';
  activationEl.classList.remove('armed');
  return run;
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

  // التفعيل اليدوي: المهارة تُحقن رسالةَ نظام في المحرك (م٤) لا تُضمَّن في
  // نص المستخدم — فتبقى خارج النص المحفوظ ولا تتضخم المحادثة بتكرارها.
  const act = activationEl.value;
  let skillId = null;
  if (act) {
    const [kind, id] = act.split('|');
    if (kind === 'skill') skillId = id;
    else text = 'كلّف العميل الجانبي «' + id + '» بالطلب التالي وقدّم لي نتيجته:\n\n' + text;
  }

  const attachments = pendingFiles.map((f) => f.path);
  addUserMsg(text, pendingFiles.map((f) => f.name));
  pendingFiles = [];
  renderAttachList();

  await dispatch({ text, attachments, skillId });
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

// مؤشر العمل: ما دام تشغيل هذه الشاشة جاريًا يبقى ظاهرًا، ويسمّي آخر أداة
// نفّذها ويعدّ الثواني — فالمستخدم يعرف أنه يعمل وأين وصل، لا شاشة صامتة.
const runStatusEl = $('#run-status');
let runTicker = null;

function updateRunStatus() {
  const run = runForCurrentView();
  runStatusEl.classList.toggle('hidden', !run);
  if (!run) {
    if (runTicker) { clearInterval(runTicker); runTicker = null; }
    return;
  }
  $('#run-status-text').textContent = run.tools.length
    ? run.tools[run.tools.length - 1]
    : 'يفكّر…';
  const tick = () => {
    const secs = Math.floor((Date.now() - run.startedAt) / 1000);
    $('#run-status-time').textContent = secs < 60
      ? `${secs} ث`
      : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  tick();
  if (!runTicker) runTicker = setInterval(tick, 1000);
}

function updateSendState() {
  const run = runForCurrentView();
  sendBtn.disabled = false;
  sendBtn.textContent = run ? '⏹ إيقاف' : 'إرسال';
  sendBtn.classList.toggle('btn-stop', Boolean(run));
  updateRunStatus();
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
    startedAt: Date.now(),
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
  // النموذج قد ينشئ مهارة أو عميلًا أثناء التشغيل (save_skill) — نعيد قراءة
  // المكتبة فتظهر فورًا في قائمة التفعيل ولوحة البداية بلا إعادة تشغيل
  populateActivation();
  renderHome();
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

// المهارة حين تُحقن حتميًا: يُعلَن ذلك — الحقن الصامت يخفي عن المستخدم
// لماذا تغيّر سلوك التطبيق
window.kunnash.onChatEvent('chat:skill', ({ requestId, id }) => {
  const run = runs.get(requestId);
  if (!run || !run.els) return;
  const chip = document.createElement('span');
  chip.className = 'tool-chip skill-chip';
  chip.textContent = '⚡ فُعّلت المهارة: ' + id;
  run.els.tools.appendChild(chip);
  scrollDown();
});

window.kunnash.onChatEvent('chat:tool', ({ requestId, name, input }) => {
  const run = runs.get(requestId);
  if (!run) return;
  const label = toolLabel(name, input);
  run.tools.push(label);
  updateRunStatus();
  if (run.els) {
    const chip = document.createElement('span');
    chip.className = 'tool-chip';
    chip.textContent = label;
    run.els.tools.appendChild(chip);
    scrollDown();
  }
});

window.kunnash.onChatEvent('chat:done', ({ requestId, text, usage }) => {
  const run = runs.get(requestId);
  if (!run) return;
  const finalText = text || run.text || '';
  if (run.els) {
    run.els.bubble.innerHTML = renderMarkdown(finalText);
    linkifyBubble(run.els.bubble);
    addCopyControls(run.els.bubble.closest('.msg'), finalText);
    // «الرقم الظاهر أرخص أداة ضبط تكلفة» — يظهر فقط حين توجد أدوات أو كلفة
    if (usage && (usage.calls || usage.cost)) {
      const meta = run.els.bubble.closest('.msg').querySelector('.meta');
      const bits = [];
      if (usage.calls) bits.push(`${usage.calls} أداة`);
      if (usage.tokens) bits.push(`${(usage.tokens / 1000).toFixed(1)}ك رمز`);
      if (usage.cost) bits.push(`$${usage.cost.toFixed(3)}`);
      meta.textContent += (meta.textContent ? ' · ' : '') + bits.join(' · ');
    }
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

// ---------- الإعدادات: عنك + الاتصال بالنموذج ----------
const settingsModal = $('#settings-modal');
const connStatusEl = $('#conn-status');
const presetRowEl = $('#preset-row');
const presetHintEl = $('#preset-hint');
const orLinkRowEl = $('#or-link-row');
const creditsLineEl = $('#credits-line');
const modelBoxEl = $('#model-picker-box');
const modelListEl = $('#model-list');

let presets = [];
let allModels = [];        // آخر قائمة جُلبت — تُفلتر محليًا بلا طلب جديد
let connServices = {};     // { host: { model, hasKey } } لكل خدمة محفوظة

function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch { return ''; } }
function isOpenRouterUrl(u) {
  const h = hostOf(u).split(':')[0];
  return h === 'openrouter.ai' || h.endsWith('.openrouter.ai');
}
function isLocalServiceUrl(u) {
  const h = hostOf(u).split(':')[0];
  return h === 'localhost' || h === '127.0.0.1';
}

// عناصر تتبدل حسب العنوان المكتوب — من مصدر واحد هو حقل العنوان
function refreshConnForm() {
  const url = $('#conn-url').value.trim();
  const or = isOpenRouterUrl(url);
  orLinkRowEl.classList.toggle('hidden', !or);
  $('#data-policy-row').classList.toggle('hidden', !or);
  $('#key-optional-note').classList.toggle('hidden', !isLocalServiceUrl(url));
  creditsLineEl.classList.toggle('hidden', !or);
  for (const b of presetRowEl.querySelectorAll('.preset-btn')) {
    const active = b.dataset.url === url;
    b.classList.toggle('active', active);
    if (active) presetHintEl.textContent = b.dataset.hint;
  }
}

// تبديل الخدمة يبدّل كل ما يخصها: نموذجها المحفوظ، وحالة مفتاحها،
// والقائمة تُفرَّغ لأن نماذج خدمة لا تصلح لأخرى.
function applyPreset(p) {
  $('#conn-label').value = p.label;
  $('#conn-url').value = p.baseUrl;
  presetHintEl.textContent = p.hint;

  const saved = connServices[hostOf(p.baseUrl)] || {};
  $('#conn-model').value = saved.model || p.exampleModel || '';
  $('#conn-key').value = '';
  $('#conn-key').placeholder = saved.hasKey
    ? '•••••••• محفوظ لهذه الخدمة — اتركه فارغًا لإبقائه'
    : (p.needsKey ? 'sk-...' : 'لا يحتاج مفتاحًا');

  allModels = [];
  modelListEl.innerHTML = '';
  modelBoxEl.classList.add('hidden');
  connStatusEl.className = 'test-status';
  connStatusEl.textContent = '';
  refreshConnForm();
}

async function renderPresets() {
  if (!presets.length) presets = await window.kunnash.getPresets();
  presetRowEl.innerHTML = '';
  for (const p of presets) {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.textContent = p.label;
    b.dataset.url = p.baseUrl;
    b.dataset.hint = p.hint;
    b.onclick = () => applyPreset(p);
    presetRowEl.appendChild(b);
  }
}

// ---------- منتقي النماذج ----------
// قائمة حقيقية لا datalist: الأخيرة تفلتر بقيمة الحقل، فبعد اختيار نموذج
// لا يبقى في القائمة إلا هو — فيتعذّر تبديله. الفلترة الآن بحقل مستقل.
function renderModelList() {
  const q = $('#model-filter').value.trim().toLowerCase();
  const shown = q ? allModels.filter((m) => (m.id + ' ' + m.name).toLowerCase().includes(q)) : allModels;
  modelListEl.innerHTML = '';
  for (const m of shown.slice(0, 400)) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.id === m.name ? m.id : `${m.id}  —  ${m.name}`;
    if (m.id === $('#conn-model').value.trim()) o.selected = true;
    modelListEl.appendChild(o);
  }
  $('#model-count').textContent = q
    ? `${shown.length} من ${allModels.length}`
    : `${allModels.length} نموذجًا`;
}

async function refreshModels() {
  const btn = $('#btn-refresh-models');
  btn.disabled = true; btn.textContent = '…';
  await saveSettings(true);   // القائمة تُجلب من العنوان المكتوب فعلًا
  const res = await window.kunnash.listModels();
  btn.disabled = false; btn.textContent = '↻ القائمة';
  connStatusEl.className = 'test-status';
  if (!res.ok) {
    connStatusEl.classList.add('fail');
    connStatusEl.textContent = '⛔ ' + res.error;
    return;
  }
  allModels = res.models;
  $('#model-filter').value = '';
  modelBoxEl.classList.remove('hidden');
  renderModelList();
}

async function refreshCredits() {
  creditsLineEl.textContent = '';
  const c = await window.kunnash.getCredits();
  if (!c.ok || !c.credits) return;
  const { usage, remaining } = c.credits;
  const parts = [];
  if (usage != null) parts.push(`استُهلك $${Number(usage).toFixed(2)}`);
  parts.push(remaining == null ? 'بلا حد للرصيد' : `المتبقي $${Number(remaining).toFixed(2)}`);
  creditsLineEl.textContent = '💳 ' + parts.join(' · ');
}

// ذاكرة ظاهرة تُحذف بنقرة — وإلا صارت مقلقة بدل أن تكون خدمة
async function renderPrefs() {
  const box = $('#prefs-list');
  const items = await window.kunnash.listPrefs();
  box.innerHTML = '';
  if (!items.length) {
    box.innerHTML = '<div class="prefs-empty">لا شيء بعد — حين يسألك كُنّاش ويعرض «احفظ اختياري» يظهر هنا.</div>';
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'pref-row';
    const txt = document.createElement('span');
    txt.innerHTML = '<b></b>: <span></span>';
    txt.querySelector('b').textContent = it.key;
    txt.querySelector('span').textContent = it.value;
    const del = document.createElement('button');
    del.className = 'pref-del';
    del.textContent = '✕';
    del.title = 'انسَ هذا';
    del.onclick = async () => { await window.kunnash.forgetPref(it.key); renderPrefs(); };
    row.appendChild(txt);
    row.appendChild(del);
    box.appendChild(row);
  }
}

async function renderRules() {
  const box = $('#rules-list');
  const rules = await window.kunnash.listRules();
  box.innerHTML = '';
  if (!rules.length) {
    box.innerHTML = '<div class="prefs-empty">لا قواعد — كل إجراء مؤثّر يسألك.</div>';
    return;
  }
  for (const r of rules) {
    const row = document.createElement('div');
    row.className = 'pref-row';
    const txt = document.createElement('span');
    txt.innerHTML = '<b></b> <span dir="ltr"></span><i></i>';
    txt.querySelector('b').textContent = r.tool;
    txt.querySelector('span').textContent = r.scope;
    if (r.expiresAt) {
      const days = Math.max(0, Math.ceil((r.expiresAt - Date.now()) / 86400000));
      txt.querySelector('i').textContent = ` — تنتهي بعد ${days} يومًا`;
    }
    const del = document.createElement('button');
    del.className = 'pref-del';
    del.textContent = '✕';
    del.title = 'اسحب هذا الإذن';
    del.onclick = async () => { await window.kunnash.revokeRule(r.tool, r.scope); renderRules(); };
    row.appendChild(txt);
    row.appendChild(del);
    box.appendChild(row);
  }
}

// كل إغلاق للإعدادات يمرّ من هنا: أثناء أول تشغيل تُعاد الخطوة الحالية
// لتلتقط ما تغيّر — بدونها يربط المستخدم النموذج ويبقى «التالي» معطّلًا.
function closeSettings() {
  settingsModal.classList.add('hidden');
  if (onboarding) renderOnboarding();
}

async function openSettings() {
  await renderPresets();
  renderPrefs();
  renderRules();
  const prof = await window.kunnash.getProfile();
  $('#profile-name').value = prof.name || '';

  const c = await window.kunnash.getConnection();
  connServices = c.services || {};
  $('#conn-label').value = c.label || '';
  $('#conn-url').value = c.baseUrl || '';
  $('#conn-model').value = c.model || '';
  $('#conn-data-policy').checked = (c.dataPolicy || 'deny') !== 'allow';
  // المفتاح لا يعبر الجسر — الحقل فارغ، ونائبه يخبر أنه محفوظ
  $('#conn-key').value = '';
  $('#conn-key').placeholder = c.hasKey ? '•••••••• محفوظ — اترك الحقل فارغًا لإبقائه' : 'sk-...';
  connStatusEl.className = 'test-status';
  connStatusEl.textContent = '';
  $('#or-link-status').textContent = '';
  allModels = [];
  modelListEl.innerHTML = '';
  modelBoxEl.classList.add('hidden');
  refreshConnForm();
  settingsModal.classList.remove('hidden');
  refreshCredits();
}

// المفتاح يُرسل فقط إن كتب المستخدم واحدًا جديدًا: الحقل الفارغ يعني «لا تغيّره»
function connectionPatch() {
  const key = $('#conn-key').value.replace(/\s+/g, '');
  return {
    label: $('#conn-label').value.trim(),
    baseUrl: $('#conn-url').value.replace(/\s+/g, ''),
    model: $('#conn-model').value.trim(),
    dataPolicy: $('#conn-data-policy').checked ? 'deny' : 'allow',
    ...(key ? { apiKey: key } : {}),
  };
}

async function saveSettings(keepOpen) {
  await window.kunnash.saveProfile({ name: $('#profile-name').value.trim() });
  await window.kunnash.saveConnection(connectionPatch());
  const c = await window.kunnash.getConnection();
  connServices = c.services || {};
  applyConnection({
    label: c.label, model: c.model,
    ready: Boolean(c.model && (c.hasKey || isLocalServiceUrl(c.baseUrl))),
  });
  applyGreeting((await window.kunnash.getProfile()).name);
  if (keepOpen !== true) closeSettings();
}

async function testConnection() {
  connStatusEl.className = 'test-status';
  connStatusEl.textContent = 'يجرّب الاتصال…';
  await saveSettings(true);   // نختبر ما هو مكتوب فعلًا لا ما كان محفوظًا
  const res = await window.kunnash.testConnection();
  if (res.ok) { connStatusEl.classList.add('ok'); connStatusEl.textContent = '✅ يعمل — رد النموذج: ' + res.reply; }
  else { connStatusEl.classList.add('fail'); connStatusEl.textContent = '⛔ ' + res.error; }
}

async function linkOpenRouterFlow() {
  const st = $('#or-link-status');
  st.className = 'test-status';
  st.textContent = 'فُتح المتصفح — أكمل الموافقة هناك…';
  await saveSettings(true);   // نثبت العنوان قبل الربط
  const res = await window.kunnash.linkOpenRouter();
  if (res.ok) {
    st.classList.add('ok');
    st.textContent = '✅ تم الربط وحُفظ المفتاح';
    $('#conn-key').value = '';
    $('#conn-key').placeholder = '•••••••• محفوظ — اترك الحقل فارغًا لإبقائه';
    await saveSettings(true);
    refreshCredits();
  } else {
    st.classList.add('fail');
    st.textContent = '⛔ ' + res.error;
  }
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
sendBtn.onclick = () => {
  const run = runForCurrentView();
  if (run) window.kunnash.cancelChat(run.requestId);
  else sendMessage();
};
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
inputEl.addEventListener('input', autoGrow);

$('#btn-new').onclick = newChat;
// زر المجلد: نقرة تفتحه، ونقر بديل (Alt أو يمين) يعرض قائمة المساحات
$('#btn-folder').onclick = (e) => {
  if (e.altKey) showWorkspaceMenu();
  else window.kunnash.openFolder();
};
$('#btn-folder').oncontextmenu = (e) => { e.preventDefault(); showWorkspaceMenu(); };

// تبديل مساحة العمل — للمستخدم سياقات متعددة (عمل، شخصي، مشروع) ولكلٍّ
// مهاراتها وأذوناتها وتفضيلاتها، فالتنقل بينها نقرة لا إعادة اختيار مجلد.
async function showWorkspaceMenu() {
  const old = document.getElementById('ws-menu');
  if (old) { old.remove(); return; }
  const list = await window.kunnash.listWorkspaces();

  const menu = document.createElement('div');
  menu.id = 'ws-menu';
  menu.className = 'ws-menu';
  for (const w of list) {
    const row = document.createElement('button');
    row.className = 'ws-item' + (w.current ? ' current' : '') + (w.missing ? ' missing' : '');
    row.innerHTML = '<strong></strong><span></span>';
    row.querySelector('strong').textContent = (w.current ? '● ' : '') + w.name;
    row.querySelector('span').textContent = w.missing ? 'غير موجود على القرص' : w.path;
    row.onclick = async () => {
      menu.remove();
      if (w.current || w.missing) return;
      await afterWorkspaceChange(await window.kunnash.switchWorkspace(w.path));
    };
    menu.appendChild(row);
  }
  const add = document.createElement('button');
  add.className = 'ws-item ws-add';
  add.textContent = '＋ افتح مجلدًا آخر';
  add.onclick = async () => {
    menu.remove();
    const info = await window.kunnash.chooseWorkspace();
    if (info) await afterWorkspaceChange(info);
  };
  menu.appendChild(add);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function once() {
    menu.remove();
    document.removeEventListener('click', once);
  }, { once: true }), 0);
}
$('#btn-library').onclick = () => { refreshLibrary(); closeLibEditor(); libraryModal.classList.remove('hidden'); };
$('#btn-close-library').onclick = () => libraryModal.classList.add('hidden');
libraryModal.addEventListener('click', (e) => { if (e.target === libraryModal) libraryModal.classList.add('hidden'); });
document.querySelectorAll('.lib-new').forEach((b) => { b.onclick = () => newLibItem(b.dataset.type); });
$('#lib-save').onclick = saveLibItem;
$('#lib-delete').onclick = deleteLibItem;
$('#btn-settings').onclick = openSettings;
$('#btn-close-settings').onclick = closeSettings;
$('#btn-save-settings').onclick = saveSettings;
$('#btn-test-conn').onclick = testConnection;
$('#btn-link-or').onclick = linkOpenRouterFlow;
$('#btn-refresh-models').onclick = refreshModels;
$('#conn-url').addEventListener('input', refreshConnForm);
$('#model-filter').addEventListener('input', renderModelList);
modelListEl.addEventListener('change', () => {
  if (modelListEl.value) $('#conn-model').value = modelListEl.value;
});
modelChipEl.onclick = openSettings;
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });


activationEl.addEventListener('change', () => {
  activationEl.classList.toggle('armed', Boolean(activationEl.value));
});

// البداية
(async () => {
  const prof = await window.kunnash.getProfile();
  applyGreeting(prof.name);
  const wsInfo = await window.kunnash.getWorkspace();
  // أول تشغيل: بلا مساحة عمل، أو لم يُكمل الجولة التعريفية بعد
  onboarding = !wsInfo || !prof.onboarded;
  applyWorkspace(wsInfo);
  if (onboarding) {
    obIndex = prof.name ? (wsInfo ? 2 : 1) : 0;   // نبدأ من أول خطوة ناقصة
    renderOnboarding();
  }
  refreshSessions();
  renderHome();
  populateActivation();
  updateSendState();
  if (!onboarding && workspace) inputEl.focus();
})();
