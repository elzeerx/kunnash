// لغتا الواجهة — العربية والإنجليزية، ونصٌّ واحد لكل معنى.
//
// **لغة الواجهة غير لغة المحادثة.** هذه تخصّ أزرار التطبيق وعناوينه؛ أما ردّ
// النموذج فيتبع **لغة سؤالك** لا لغة الواجهة (قاعدة في lib/agent/index.js).
// فمن واجهته إنجليزية وكتب بالعربية يُجاب بالعربية — وهذا هو الصواب: اللغة
// التي تكتب بها هي التي تريد أن تُخاطَب بها.
//
// والقلب كامل: dir على <html> ينقلب، والتنسيق كله بخصائص منطقية
// (inline-start/end) لا فيزيائية، فينقلب معه بلا قاعدة واحدة مكرّرة.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.i18n = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const S = {
    // ---------- الشريط الجانبي ----------
    tagline:        ['دفتر العالِم الذي يجمع فيه ما ينفعه', 'The scholar’s notebook for all that serves'],
    newChat:        ['＋ محادثة جديدة', '＋ New chat'],
    chats:          ['المحادثات', 'Chats'],
    library:        ['🤖 العملاء والمهارات', '🤖 Agents & skills'],
    libraryTitle:   ['إدارة العملاء والمهارات', 'Manage agents and skills'],
    workspace:      ['مجلد العمل', 'Workspace'],
    workspaceTitle: ['فتح مجلد العمل', 'Open workspace folder'],
    settings:       ['⚙️ الإعدادات', '⚙️ Settings'],
    settingsTitle:  ['الاتصال بالنموذج', 'Model connection'],

    // ---------- أول تشغيل ----------
    welcome:    ['حيّاك الله في كُنّاش', 'Welcome to Kunnash'],
    next:       ['التالي', 'Next'],
    skipStep:   ['تخطَّ هذه الخطوة', 'Skip this step'],

    // ---------- لوحة البداية ----------
    greeting:      ['حيّاك الله', 'Welcome'],
    greetingNamed: ['حيّاك الله يا {name}', 'Welcome, {name}'],
    quickTasks:    ['⚡ مهام سريعة', '⚡ Quick tasks'],
    quickHint:     ['تنفّذ مهاراتك بنقرة', 'Run your skills with one click'],
    recentFiles:   ['📁 آخر الملفات المحدثة', '📁 Recently changed files'],
    recentHint:    ['انقر ملفًا لتحليله', 'Click a file to work on it'],

    // ---------- صندوق الكتابة ----------
    working:      ['يعمل…', 'Working…'],
    composerHint: ['اكتب رسالتك… (Enter للإرسال، Shift+Enter لسطر جديد، أو اسحب ملفات هنا)',
                   'Type your message… (Enter to send, Shift+Enter for a new line, or drop files here)'],
    attach:       ['إرفاق ملفات', 'Attach files'],
    activation:   ['تفعيل مهارة أو تكليف عميل', 'Trigger a skill or assign an agent'],
    autoTrigger:  ['تفعيل تلقائي', 'Automatic'],
    noModel:      ['لم يُحدَّد نموذج', 'No model selected'],
    pickModel:    ['اختر النموذج', 'Choose a model'],
    pickEmpty:    ['لا قائمة محفوظة بعد — افتح «إدارة الاتصال والقائمة» واضغط «تحديث القائمة» مرة واحدة.',
                   'No saved list yet — open “Manage connection” and press “Refresh list” once.'],
    pickManage:   ['إدارة الاتصال والقائمة', 'Manage connection & list'],
    pickFromList: ['اختر من القائمة ({n} نموذجًا)', 'Choose from list ({n} models)'],
    modelChipTitle: ['تغيير النموذج', 'Change model'],
    send:         ['إرسال', 'Send'],
    privacyNote:  ['ما تكتبه هنا يغادر جهازك إلى مزوّد النموذج الذي اخترته · ملفاتك تبقى مكانها',
                   'What you type leaves your Mac for the model provider you chose · your files stay put'],

    // ---------- الإعدادات ----------
    aboutYou:      ['عنك', 'About you'],
    yourName:      ['الاسم الذي تحب أن يناديك به', 'What should it call you'],
    yourNameHint:  ['مثال: نوّاف', 'e.g. Nawaf'],
    updateCheckLabel: ['أخبرني حين يصدر تحديث', 'Tell me when an update is out'],
    updateCheckNote: [
      'يسأل GitHub مرةً كل يوم: هل من إصدار أحدث؟ لا يُرسل عنك شيئًا — لا اسمًا ولا معرّفًا ولا إحصاءً — ولا يُنزّل شيئًا ولا يحدّث نفسه؛ يخبرك والتحميل بيدك.',
      'Asks GitHub once a day whether a newer release exists. Nothing about you is sent — no name, no identifier, no analytics — and nothing is downloaded; it tells you, and downloading stays your call.',
    ],
    updateFound:   ['إصدار جديد: {version}', 'New version available: {version}'],
    updateGet:     ['حمّل', 'Get it'],
    updateLater:   ['لاحقًا', 'Later'],
    uiLanguage:    ['لغة الواجهة', 'Interface language'],
    uiLanguageNote: ['يخصّ أزرار التطبيق وعناوينه. أما ردّ النموذج فيأتي **بلغة سؤالك** — من كتب بالعربية أُجيب بالعربية.',
                     'This changes the app’s own labels. The model still replies **in the language you write in**.'],
    memory:        ['ما يتذكره كُنّاش عنك', 'What Kunnash remembers'],
    memoryNote:    ['لا يُحفظ شيء إلا باختيارك الصريح، وكل بند هنا يُحذف بنقرة.',
                    'Nothing is saved unless you explicitly choose to. Every item here is one click from gone.'],
    rules:         ['الأذونات الدائمة', 'Standing permissions'],
    rulesNote:     ['ما سمحتَ به «دائمًا» — كل قاعدة محصورة في نطاق الطلب الذي ولّدها، وتُسحب بنقرة.',
                    'What you allowed “always” — each rule is confined to the request that created it, and revoked with one click.'],
    connection:    ['الاتصال بالنموذج', 'Model connection'],
    connectionNote: ['اختر خدمة جاهزة أو اكتب أي خدمة تتكلم لغة OpenAI. المفتاح يُحفظ مشفَّرًا على جهازك، ولكل خدمة مفتاحها ونموذجها.',
                     'Pick a preset or point it at any OpenAI-compatible service. Your key is stored encrypted on this Mac, and each service keeps its own key and model.'],
    linkOr:        ['🔗 الربط بضغطة — يفتح المتصفح', '🔗 Link in one click — opens your browser'],
    chosenModel:   ['النموذج المختار', 'Model'],
    modelName:     ['اسم النموذج', 'Model name'],
    refreshModels: ['↻ تحديث القائمة', '↻ Refresh list'],
    refreshTitle:  ['جلب أحدث قائمة نماذج من الخدمة — القائمة المحفوظة معروضة أصلًا', 'Fetch the latest model list — the saved list is already shown'],
    searchModels:  ['ابحث في القائمة… (مثال: sonnet)', 'Search the list… (e.g. sonnet)'],
    apiKey:        ['المفتاح', 'API key'],
    keyOptional:   ['— الخدمة المحلية لا تحتاجه', '— not needed for a local service'],
    advanced:      ['خيارات متقدمة', 'Advanced'],
    displayName:   ['الاسم الظاهر', 'Display name'],
    baseUrl:       ['عنوان الخدمة (Base URL)', 'Service address (Base URL)'],
    dataPolicy:    ['لا تمرّر طلباتي لمزوّد يتدرّب على البيانات', 'Don’t route my requests to providers that train on data'],
    dataPolicyNote: ['(خيار OpenRouter — قد يحجب نماذج قليلة)', '(an OpenRouter option — may hide a few models)'],
    save:          ['حفظ', 'Save'],
    testConn:      ['🔌 اختبار الاتصال', '🔌 Test connection'],

    // ---------- المكتبة ----------
    libraryNote:   ['تُحفظ كملفات في {dir} داخل مجلد عملك — تنقلها وتشاركها كما تنقل أي ملف.',
                    'Saved as plain files in {dir} inside your workspace — move them and share them like any file.'],
    sideAgents:    ['العملاء الجانبيون', 'Side agents'],
    newAgent:      ['＋ عميل جديد', '＋ New agent'],
    skills:        ['المهارات', 'Skills'],
    newSkill:      ['＋ مهارة جديدة', '＋ New skill'],
    pickOrCreate:  ['اختر عنصرًا من القائمة أو أنشئ جديدًا', 'Pick one from the list, or create a new one'],
    identifier:    ['المعرّف:', 'Identifier:'],
    delete:        ['حذف', 'Delete'],

    // ---------- الإذن ----------
    permTitle:  ['يطلب كُنّاش إذنك', 'Kunnash needs your permission'],
    allowOnce:  ['السماح مرة واحدة', 'Allow once'],
    allowAlways: ['السماح دائمًا', 'Allow always'],
    deny:       ['رفض', 'Deny'],

    // ---------- النسخ ----------
    copyReply:  ['⧉ نسخ الرد', '⧉ Copy reply'],
    copyReplyTitle: ['نسخ الرد كاملًا', 'Copy the whole reply'],
    copy:       ['⧉ نسخ', '⧉ Copy'],
    editRetry:  ['✎ تعديل وإعادة', '✎ Edit & resend'],
    editRetryTitle: ['يعيد نصّك إلى صندوق الكتابة لتصحّحه وترسله — بلا كتابته ثانية',
                     'Puts your text back in the composer to fix and resend — no retyping'],
    copied:     ['✓ نُسخ', '✓ Copied'],
    copyDraft:  ['نسخ المسودة وحدها', 'Copy the draft only'],
    copyBlock:  ['نسخ هذه الكتلة', 'Copy this block'],
    plainText:  ['نص', 'text'],
    lblDraft:   ['مسودة', 'Draft'],
    lblTable:   ['جدول', 'Table'],
    thinking:   ['يفكّر', 'Thinking'],
    thinkingDots: ['يفكّر…', 'Thinking…'],

    // ---------- الوقت ----------
    // العربية تصرّف العدد؛ فصلنا صيغة الواحد والاثنين عن الجمع بدل «1 ساعة».
    minutesAgo: ['قبل دقائق', 'A few minutes ago'],
    hourAgo:    ['قبل ساعة', 'An hour ago'],
    hoursAgo:   ['قبل {n} ساعات', '{n} hours ago'],
    yesterday:  ['أمس', 'Yesterday'],
    daysAgo:    ['قبل {n} يومًا', '{n} days ago'],

    // ---------- أول تشغيل ----------
    obName:      ['اسمك', 'Your name'],
    obNameLede:  ['بمَ تحب أن يناديك؟ (يظهر في الترحيب فقط، ويبقى على جهازك)',
                  'What should it call you? (used in the greeting only, and it stays on this Mac)'],
    obWorkspace: ['مجلد العمل', 'Workspace'],
    obWsLede:    ['كُنّاش يشتغل على مجلد تختاره أنت — ملفاتك تبقى مكانها، وهو يقرأ منها ويكتب فيها.',
                  'Kunnash works inside a folder you choose — your files stay where they are, and it reads and writes there.'],
    obModel:     ['النموذج', 'Model'],
    obModelLede: ['اربط النموذج الذي تريد — بضغطة عبر OpenRouter، أو بمفتاح خدمة تملكها.',
                  'Connect the model you want — one click through OpenRouter, or a key from a service you already pay for.'],
    obSkills:    ['مهاراتك', 'Your skills'],
    obSkillsLede: ['ابدأ بمهارات جاهزة بدل صفحة فارغة — تُنسخ إلى مجلدك فتصير ملكك، تعدّلها وتحذفها كما تشاء.',
                   'Start with ready-made skills instead of a blank page — they’re copied into your folder, so they become yours to edit or delete.'],
    startWorking: ['ابدأ العمل', 'Start working'],
    pickAnother:  ['اختر مجلدًا آخر', 'Choose a different folder'],

    // ---------- حالات الاتصال ----------
    noConnection:   ['بلا اتصال', 'Not connected'],
    finishSetup:    ['أكمل الاتصال ⚙️', 'Finish setup ⚙️'],
    finishSetupLong: ['أكمل الاتصال من الإعدادات ⚙️', 'Finish the connection in Settings ⚙️'],
    editConnection: ['تعديل الاتصال', 'Edit connection'],
    noModelShort:   ['بلا نموذج', 'No model'],
    testing:        ['يجرّب الاتصال…', 'Testing…'],
    browserOpened:  ['فُتح المتصفح — أكمل الموافقة هناك…', 'Browser opened — finish approving there…'],
    noKeyNeeded:    ['لا يحتاج مفتاحًا', 'No key needed'],
    keyStored:      ['•••••••• محفوظ — اترك الحقل فارغًا لإبقائه', '•••••••• stored — leave blank to keep it'],
    keyStoredSvc:   ['•••••••• محفوظ لهذه الخدمة — اتركه فارغًا لإبقائه', '•••••••• stored for this service — leave blank to keep it'],
    noCreditLimit:  ['بلا حد للرصيد', 'No credit limit'],
    savedMark:      [' · محفوظ', ' · stored'],
    retry:          ['↻ إعادة المحاولة', '↻ Retry'],

    // ---------- المحادثة والجلسات ----------
    newSession:   [' — جديد', ' — new'],
    deleteChat:   ['حذف المحادثة', 'Delete chat'],
    running:      ['هذه المحادثة تعمل الآن', 'This chat is running'],
    stopped:      ['هذه المحادثة توقفت قبل اكتمال الرد.', 'This chat stopped before the reply finished.'],
    taskDone:     ['انتهت المهمة', 'Task finished'],
    taskStopped:  ['توقفت المهمة', 'Task stopped'],
    needsPermission: ['يحتاج إذنك للمتابعة', 'Needs your permission to continue'],
    permThisRunOnly: ['«السماح دائمًا» لهذا التشغيل وحده', '“Allow always” applies to this run only'],
    revokeRule:   ['اسحب هذا الإذن', 'Revoke this permission'],
    forgetThis:   ['انسَ هذا', 'Forget this'],

    // ---------- اللوحة والمكتبة ----------
    noSkillsYet:  ['أنشئ مهاراتك من «🤖 العملاء والمهارات»', 'Create skills from “🤖 Agents & skills”'],
    noPrefsYet:   ['لا شيء بعد — حين يسألك كُنّاش ويعرض «احفظ اختياري» يظهر هنا.',
                   'Nothing yet — when Kunnash asks and offers “remember my choice”, it lands here.'],
    noRulesYet:   ['لا قواعد — كل إجراء مؤثّر يسألك.', 'No rules — every consequential action asks you.'],
    openFile:     ['فتح الملف', 'Open file'],
    clickToOpen:  ['انقر لفتح الملف', 'Click to open the file'],
    missingOnDisk: ['غير موجود على القرص', 'Not on disk'],
    idFirst:      ['اكتب المعرّف أولًا — هو اسم مجلد المهارة (مثل: weekly-report أو «تقرير-الأسبوع»)',
                   'Write the identifier first — it becomes the skill’s folder name (e.g. weekly-report)'],
    skill:        ['مهارة', 'Skill'],
    sideAgent:    ['عميل جانبي', 'Side agent'],
    yourChoice:   ['اختر أنت', 'You choose'],
    triggerSkill: ['تفعيل مهارة', 'Trigger a skill'],
    assignAgent:  ['تكليف عميل', 'Assign an agent'],

    // ---------- طلبات جاهزة ----------
    runThisSkill: ['نفّذ هذه المهارة الآن.', 'Run this skill now.'],
    summarizeFile: ['لخّص لي أهم ما في الملف المرفق.', 'Summarize the key points of the attached file.'],
    assignAgentReq: ['كلّف العميل الجانبي «{id}» بالطلب التالي وقدّم لي نتيجته:\n\n',
                     'Assign side agent “{id}” the following request and report its result:\n\n'],

    // ---------- تسميات الأدوات (تظهر شرائحَ أثناء العمل) ----------
    tRead:       ['📖 يقرأ', '📖 Reading'],
    tWrite:      ['✏️ يكتب ملفًا', '✏️ Writing a file'],
    tEdit:       ['✏️ يعدّل', '✏️ Editing'],
    tTrash:      ['🗑️ ينقل إلى المهملات', '🗑️ Moving to trash'],
    tList:       ['🔍 يبحث عن ملفات', '🔍 Looking for files'],
    tSearch:     ['🔍 يبحث في المحتوى', '🔍 Searching contents'],
    tExcel:      ['📊 يقرأ جدول Excel', '📊 Reading an Excel sheet'],
    tDoc:        ['📄 يقرأ مستندًا', '📄 Reading a document'],
    tRender:     ['🖨️ يُخرج مستندًا', '🖨️ Producing a document'],
    tFetch:      ['🌐 يفتح رابطًا', '🌐 Opening a link'],
    tTodo:       ['📋 ينظّم المهام', '📋 Organizing tasks'],
    tSkills:     ['⚡ يستعرض المهارات', '⚡ Browsing skills'],
    tSkill:      ['⚡ يقرأ مهارة', '⚡ Reading a skill'],
    tAgent:      ['🤖 يشغّل عميلًا جانبيًا', '🤖 Running a side agent'],
    skillFired:  ['⚡ فُعّلت المهارة: ', '⚡ Skill triggered: '],

    // ---------- أزرار وحالات متفرقة ----------
    stop:        ['⏹ إيقاف', '⏹ Stop'],
    openSettingsLink: ['⚙️ افتح الإعدادات واربط', '⚙️ Open Settings and connect'],
    linked:      ['✅ تم الربط وحُفظ المفتاح', '✅ Linked, key stored'],
    saved:       ['✅ حُفظ', '✅ Saved'],
    connWorks:   ['✅ يعمل — رد النموذج: ', '✅ Works — the model replied: '],
    alreadyInstalled: ['✓ مثبّتة سلفًا', '✓ Already installed'],
    noChoice:    ['✕ بلا اختيار', '✕ No choice'],
    openAnother: ['＋ افتح مجلدًا آخر', '＋ Open another folder'],
    pickWorkspace: ['📁 اختر مجلد العمل', '📁 Choose your workspace'],
    remove:      ['إزالة', 'Remove'],
    nSkills:     ['{n} مهارات', '{n} skills'],
    installedN:  ['✓ ثُبّتت {n} مهارات', '✓ Installed {n} skills'],
    toolRequest: ['طلب استخدام أداة {tool}', 'Requests the {tool} tool'],
    toolNamed:   ['أداة {tool}', '{tool} tool'],
    alwaysSaves: ['«السماح دائمًا» يحفظ قاعدة: {scope}', '“Allow always” saves a rule: {scope}'],
    rememberMy:  ['احفظ اختياري لـ«{key}» فلا تسألني مرة أخرى', 'Remember my choice for “{key}” and stop asking'],
    seconds:     ['{n} ث', '{n}s'],
    nTools:      ['{n} أداة', '{n} tools'],
    nTokens:     ['{n}ك رمز', '{n}k tokens'],
    nOfM:        ['{n} من {m}', '{n} of {m}'],
    nModels:     ['{n} نموذجًا', '{n} models'],
    spent:       ['استُهلك ${n}', 'Spent ${n}'],
    remaining:   ['المتبقي ${n}', '${n} left'],
    expiresIn:   [' — تنتهي بعد {n} يومًا', ' — expires in {n} days'],
    confirmDelete: ['متأكد من حذف «{id}»؟ سيُحذف الملف من .kunnash نهائيًا.',
                    'Delete “{id}”? The file will be permanently removed from .kunnash.'],
  };

  const LANGS = ['ar', 'en'];
  let lang = 'ar';

  /** @param {string} key @param {object} [vars] — {name} تُستبدل */
  function t(key, vars) {
    const row = S[key];
    if (!row) return key;                       // مفتاح مجهول يظهر كما هو، فيُرى في التجربة
    let out = row[LANGS.indexOf(lang)] || row[0];
    if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(vars[k]);
    return out;
  }

  function getLang() { return lang; }
  function dirOf(l) { return l === 'ar' ? 'rtl' : 'ltr'; }

  /** يملأ كل عنصر يحمل data-i18n — النص أو الـplaceholder أو الـtitle */
  function applyDom(scope) {
    const el = scope || document;
    for (const n of el.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
    for (const n of el.querySelectorAll('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
    for (const n of el.querySelectorAll('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
  }

  /** يبدّل اللغة ويقلب اتجاه الواجهة كلها */
  function setLang(next) {
    lang = LANGS.includes(next) ? next : 'ar';
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.documentElement.dir = dirOf(lang);
      applyDom();
    }
    return lang;
  }

  // ملء فوري بالعربية عند التحميل. النص الحرفي غادر HTML إلى هنا، فلولا هذا
  // بقيت الحقول خرساء (placeholder وtitle) حتى يستدعي app.js اللغة المحفوظة
  // — ولو تعثّر شيء قبله لشُحنت واجهة بلا نصوص. الافتراض قبل التفضيل.
  if (typeof document !== 'undefined') applyDom();

  return { t, setLang, getLang, dirOf, applyDom, LANGS, STRINGS: S };
});
