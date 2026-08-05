// أدوات الحلقة — التنفيذ والمخططات معًا، وكل أداة ملفات تمرّ بحارس المسار.
//
// القرارات المثبتة النافذة هنا:
//   لا صدفة: لا bash ولا exec في أي مسار — التغطية بالأدوات المسماة.
//   لا unlink: delete_file نقلٌ إلى .kunnash/trash/ لا حذف.
//   القصّ عند المنبع: النتائج تُسقّف هنا (٤٠ ألف حرف للقراءة، ٢٠٠ مسار،
//   ١٠٠ نتيجة بحث) — أرخص معالجات نمو التكلفة التربيعي.
//   الأوصاف قصيرة بصيغة الأمر: سقف المخططات مجتمعةً ~١٥٠٠ رمز.

const fs = require('fs');
const path = require('path');

const { resolveInWorkspace, writeFileGuarded } = require('../paths');
const { xlsxToCsv, docxToText, buildDocx, buildHtml } = require('./office');
const library = require('../library');
const prefs = require('../preferences');

const READ_CAP = 40000;        // حرف — read_file / read_excel / read_document
const LIST_CAP = 200;
const SEARCH_CAP = 100;
const FETCH_CAP_DEFAULT = 20000;

// ---------- عدّ الأسطر والقصّ ----------
function numberLines(text, offset = 0) {
  return text.split('\n').map((l, i) => `${offset + i + 1}\t${l}`).join('\n');
}
function capText(text, cap = READ_CAP) {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

// ---------- مشي الشجرة (يخدم list/search) ----------
const WALK_EXCLUDE = new Set(['node_modules', '.git', '.kunnash', '.claude']);

function* walkFiles(root, startAbs) {
  const stack = [startAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        // follow:false — والرابط الداخلي المشروع يصل عبر إعادة فحص الحارس
        continue;
      }
      if (e.isDirectory()) {
        if (!WALK_EXCLUDE.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        yield full;
      }
    }
  }
}

// glob بسيط: * داخل المقطع، ** يعبر المقاطع.
// التحويل عبر علامات وسيطة: الاستبدال المباشر المتسلسل يعيد الكتابة فوق
// صيغ regex أدخلتها الخطوة السابقة (`?` من `(?:...)` تُستبدل بدورها) —
// خطأ أمسكه اختبار.
function globToRegex(pattern) {
  const G_DIR = '', G_ALL = '', G_ONE = '', G_CH = '';
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, G_DIR)
    .replace(/\*\*/g, G_ALL)
    .replace(/\*/g, G_ONE)
    .replace(/\?/g, G_CH)
    .replaceAll(G_DIR, '(?:.*/)?')
    .replaceAll(G_ALL, '.*')
    .replaceAll(G_ONE, '[^/]*')
    .replaceAll(G_CH, '[^/]');
  return new RegExp('^' + re + '$');
}

// ---------- حماية fetch_url من الشبكات الداخلية ----------
function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('الرابط غير صالح.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('يُقبل http/https فقط.');
  }
  const h = u.hostname.toLowerCase();
  const priv =
    h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '::1' || h === '[::1]' || h.startsWith('fd') || h.startsWith('fe80');
  if (priv) throw new Error('لا وصول لعناوين الشبكة المحلية أو الداخلية.');
  return u;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
}

// ---------- تعريف الأدوات ----------
// permission: 'none' قراءة حرة · 'ask' تمر ببوابة الإذن (§٧: التصنيف بالأثر)
// كل exec يستقبل (args, ctx) حيث ctx = { root, runAgent? }

const TOOLS = [
  {
    name: 'read_file',
    description: 'اقرأ ملفًا نصيًا من مساحة العمل. مثال: {"path":"تقارير/يوليو.md"}',
    permission: 'none',
    params: {
      path: { type: 'string', required: true },
      offset: { type: 'number', hint: 'سطر البداية (1)' },
      limit: { type: 'number', hint: 'عدد الأسطر' },
    },
    exec({ path: p, offset, limit }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, p, { mustExist: true });
      if (fs.statSync(abs).isDirectory()) {
        const names = fs.readdirSync(abs).filter((n) => !n.startsWith('.')).slice(0, 50);
        return `«${rel}» مجلد لا ملف. محتواه: ${names.join('، ') || '(فارغ)'}`;
      }
      const all = fs.readFileSync(abs, 'utf8').split('\n');
      const start = Math.max(0, (offset || 1) - 1);
      const lines = all.slice(start, limit ? start + limit : undefined);
      const { text, truncated } = capText(numberLines(lines.join('\n'), start));
      return text + (truncated || (limit && start + limit < all.length)
        ? `\n… (اقتُطع — الملف ${all.length} سطرًا، استعمل offset/limit)` : '');
    },
  },
  {
    name: 'write_file',
    description: 'اكتب ملفًا (ينشئ المجلدات الناقصة). مثال: {"path":"مخرجات/تقرير.md","content":"..."}',
    permission: 'ask',
    params: {
      path: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    exec({ path: p, content }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, p, { forWrite: true });
      const existed = fs.existsSync(abs);
      writeFileGuarded(abs, content);
      return JSON.stringify({ path: rel, bytes: Buffer.byteLength(content), state: existed ? 'overwritten' : 'created' });
    },
  },
  {
    name: 'edit_file',
    description: 'استبدل نصًا داخل ملف. old_text يجب أن يطابق موضعًا واحدًا (أو استخدم replace_all). مثال: {"path":"خطة.md","old_text":"قيد التنفيذ","new_text":"منجز"}',
    permission: 'ask',
    params: {
      path: { type: 'string', required: true },
      old_text: { type: 'string', required: true },
      new_text: { type: 'string', required: true },
      replace_all: { type: 'boolean' },
    },
    exec({ path: p, old_text, new_text, replace_all }, { root }) {
      const { abs } = resolveInWorkspace(root, p, { mustExist: true, forWrite: true });
      const src = fs.readFileSync(abs, 'utf8');
      const count = src.split(old_text).length - 1;
      if (count === 0) throw new Error('old_text غير موجود في الملف — اقرأه وانسخ النص حرفيًا.');
      if (count > 1 && !replace_all) {
        throw new Error(`old_text يطابق ${count} مواضع — وسّعه ليصير فريدًا أو مرر replace_all:true.`);
      }
      const out = replace_all ? src.split(old_text).join(new_text) : src.replace(old_text, new_text);
      writeFileGuarded(abs, out);
      return JSON.stringify({ replacements: replace_all ? count : 1 });
    },
  },
  {
    name: 'delete_file',
    description: 'انقل ملفًا إلى مهملات كُنّاش (لا حذف نهائيًا). مثال: {"path":"مسودة-قديمة.md"}',
    permission: 'ask',
    params: { path: { type: 'string', required: true } },
    exec({ path: p }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, p, { mustExist: true, forWrite: true });
      const trashDir = path.join(root, '.kunnash', 'trash');
      fs.mkdirSync(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = path.join(trashDir, `${stamp}-${path.basename(abs)}`);
      fs.renameSync(abs, target);
      return JSON.stringify({ moved_to: path.relative(root, target), from: rel });
    },
  },
  {
    name: 'list_files',
    description: 'اعثر على ملفات بنمط glob. مثال: {"pattern":"**/*.xlsx"}',
    permission: 'none',
    params: {
      pattern: { type: 'string', required: true },
      path: { type: 'string', hint: 'مجلد البداية' },
      modified_after: { type: 'string', hint: 'ISO date' },
    },
    exec({ pattern, path: startP, modified_after }, { root }) {
      const { abs: startAbs } = resolveInWorkspace(root, startP || '.', { mustExist: true });
      const re = globToRegex(pattern);
      const after = modified_after ? Date.parse(modified_after) : null;
      const out = [];
      for (const f of walkFiles(root, startAbs)) {
        let rel;
        try { rel = resolveInWorkspace(root, f).rel; } catch { continue; }   // إعادة فحص كل نتيجة
        if (!re.test(rel) && !re.test(path.basename(rel))) continue;
        const st = fs.statSync(f);
        if (after && st.mtimeMs < after) continue;
        out.push({ rel, mtime: st.mtimeMs });
        if (out.length >= 2000) break;
      }
      out.sort((a, b) => b.mtime - a.mtime);
      const top = out.slice(0, LIST_CAP);
      return top.map((x) => x.rel).join('\n') +
        (out.length > LIST_CAP ? `\n… (${out.length} نتيجة — عُرض أحدث ${LIST_CAP})` : '') ||
        'لا ملفات تطابق النمط.';
    },
  },
  {
    name: 'search_files',
    description: 'ابحث في محتوى الملفات النصية. مثال: {"query":"المورد الرئيسي","glob":"**/*.md"}',
    permission: 'none',
    params: {
      query: { type: 'string', required: true },
      path: { type: 'string' },
      glob: { type: 'string' },
      regex: { type: 'boolean' },
    },
    exec({ query, path: startP, glob, regex }, { root }) {
      const { abs: startAbs } = resolveInWorkspace(root, startP || '.', { mustExist: true });
      const fileRe = glob ? globToRegex(glob) : null;
      let matcher;
      if (regex) {
        try { matcher = new RegExp(query, 'iu'); } catch { throw new Error('التعبير النمطي غير صالح.'); }
      }
      const TEXT_EXTS = /\.(md|txt|csv|json|html?|xml|ya?ml|js|ts|css|py|swift|sh)$/i;
      const out = [];
      outer:
      for (const f of walkFiles(root, startAbs)) {
        let rel;
        try { rel = resolveInWorkspace(root, f).rel; } catch { continue; }
        if (fileRe && !fileRe.test(rel)) continue;
        if (!fileRe && !TEXT_EXTS.test(rel)) continue;
        let content;
        try {
          if (fs.statSync(f).size > 2 * 1024 * 1024) continue;
          content = fs.readFileSync(f, 'utf8');
        } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const hit = matcher ? matcher.test(lines[i]) : lines[i].includes(query);
          if (!hit) continue;
          out.push(`${rel}:${i + 1}:${lines[i].trim().slice(0, 160)}`);
          if (out.length >= SEARCH_CAP) break outer;
        }
      }
      return out.join('\n') || 'لا نتائج.';
    },
  },
  {
    name: 'read_excel',
    description: 'اقرأ جدول Excel كـCSV. مثال: {"path":"ميزانية.xlsx"}',
    permission: 'none',
    params: {
      path: { type: 'string', required: true },
      sheet: { type: 'string', hint: 'اسم الورقة' },
    },
    exec({ path: p, sheet }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, p, { mustExist: true });
      if (/\.xls$/i.test(rel)) throw new Error('صيغة xls القديمة غير مدعومة — افتح الملف واحفظه xlsx.');
      const sheets = xlsxToCsv(abs, sheet);
      let out = sheets.map((s) => `=== ورقة: ${s.name} ===\n${s.csv}`).join('\n\n');
      const capped = capText(out);
      return capped.text + (capped.truncated ? '\n… (اقتُطع — اطلب ورقة محددة بـsheet)' : '');
    },
  },
  {
    name: 'read_document',
    description: 'اقرأ نص مستند docx. مثال: {"path":"خطاب.docx"}',
    permission: 'none',
    params: { path: { type: 'string', required: true } },
    exec({ path: p }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, p, { mustExist: true });
      if (/\.pdf$/i.test(rel)) throw new Error('قراءة PDF لم تُبنَ بعد — صدّر المستند نصًا أو docx.');
      const { text, truncated } = capText(docxToText(abs));
      return text + (truncated ? '\n… (اقتُطع)' : '');
    },
  },
  {
    name: 'render_document',
    description: 'أخرج مستندًا منسقًا من ماركداون. مثال: {"format":"docx","title":"تقرير يوليو","content":"# ملخص\\n...","out_path":"مخرجات/تقرير-يوليو.docx"}',
    permission: 'ask',
    params: {
      format: { type: 'string', required: true, enum: ['html', 'docx'] },
      title: { type: 'string', required: true },
      content: { type: 'string', required: true },
      out_path: { type: 'string', required: true },
    },
    exec({ format, title, content, out_path }, { root }) {
      const { abs, rel } = resolveInWorkspace(root, out_path, { forWrite: true });
      const data = format === 'docx' ? buildDocx({ title, content }) : buildHtml({ title, content });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      return JSON.stringify({ path: rel, bytes: data.length });
    },
  },
  {
    name: 'fetch_url',
    description: 'اجلب نص صفحة ويب عامة. مثال: {"url":"https://example.org/خبر"}',
    permission: 'ask',
    params: {
      url: { type: 'string', required: true },
      max_chars: { type: 'number' },
    },
    async exec({ url, max_chars }) {
      const u = assertPublicUrl(url);
      const res = await fetch(u, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'Kunnash/0.1 (personal desk app)' },
      });
      if (!res.ok) throw new Error(`الخادم ردّ ${res.status}.`);
      const type = res.headers.get('content-type') || '';
      const body = await res.text();
      const text = /html/i.test(type) ? htmlToText(body) : body;
      const cap = Math.min(max_chars || FETCH_CAP_DEFAULT, 60000);
      return text.length > cap ? text.slice(0, cap) + '\n… (اقتُطع)' : text;
    },
  },
  {
    name: 'todo_write',
    description: 'دوّن خطة خطواتك وحدّثها مع التقدم. مثال: {"items":["اقرأ الجدول","اكتب الملخص"]}',
    permission: 'none',
    params: { items: { type: 'array', required: true } },
    exec({ items }) {
      // بلا أثر جانبي — الفائدة تماسك النماذج الضعيفة في المهام الطويلة
      return items.map((x, i) => `${i + 1}. ${String(x)}`).join('\n');
    },
  },
  {
    name: 'list_skills',
    description: 'اعرض مهارات مساحة العمل وعملاءها.',
    permission: 'none',
    params: {},
    exec(_a, { root }) {
      const { skills, agents } = library.listLibrary(root);
      const fmt = (arr) => arr.map((s) => `- ${s.id}: ${s.description || s.name}`).join('\n') || '(لا شيء)';
      return `المهارات:\n${fmt(skills)}\n\nالعملاء:\n${fmt(agents)}`;
    },
  },
  {
    name: 'read_skill',
    description: 'اقرأ نص مهارة كاملًا بمعرّفها. مثال: {"id":"weekly-report"}',
    permission: 'none',
    params: { id: { type: 'string', required: true } },
    exec({ id }, { root }) {
      const content = library.readItem(root, 'skill', id);
      // سرد الملفات المرفقة بجانب SKILL.md — قد تحمل قوالب تحتاجها المهارة
      let extras = '';
      for (const base of ['.kunnash', '.claude']) {
        const dir = path.join(root, base, 'skills', id);
        if (!fs.existsSync(dir)) continue;
        const others = fs.readdirSync(dir).filter((f) => f !== 'SKILL.md' && !f.startsWith('.'));
        if (others.length) extras = `\n\nملفات مرفقة بالمهارة: ${others.map((f) => `${base}/skills/${id}/${f}`).join('، ')}`;
        break;
      }
      return content + extras;
    },
  },
  {
    // سؤال المستخدم بخيارات — لا حوار مفتوح. النموذج يسأل حين ينقصه قرارٌ
    // يملكه المستخدم وحده (صيغة المخرَج مثلًا)، فيجيب بنقرة. وremember_key
    // يتيح له حفظ جوابه فلا يُسأل ثانية — وهنا تبدأ ذاكرة كُنّاش عن صاحبه.
    name: 'ask_user',
    description: 'اسأل المستخدم سؤالًا بخيارات جاهزة حين ينقصك قرار يملكه هو. مثال: {"question":"بأي صيغة تريد الملف؟","options":["Word (docx)","صفحة HTML","ماركداون","اتركه في المحادثة"],"remember_key":"صيغة المخرجات"}',
    permission: 'none',
    params: {
      question: { type: 'string', required: true },
      options: { type: 'array', required: true, hint: 'من خيارين إلى خمسة' },
      remember_key: { type: 'string', hint: 'اسم التفضيل إن كان يستحق الحفظ' },
    },
    async exec({ question, options, remember_key }, ctx) {
      if (!ctx.askUser) throw new Error('السؤال غير متاح هنا — اختر أنسب خيار واذكر ما افترضت.');
      const opts = options.map((o) => String(o).slice(0, 80)).filter(Boolean).slice(0, 5);
      if (opts.length < 2) throw new Error('ask_user يحتاج خيارين على الأقل.');

      const key = remember_key ? String(remember_key).slice(0, 60) : null;
      const { answer, remember } = await ctx.askUser({
        question: String(question).slice(0, 300),
        options: opts,
        rememberKey: key,
      });
      if (!answer) return 'أغلق المستخدم السؤال بلا اختيار — اختر أنسب خيار واذكر ما افترضت.';

      let note = '';
      if (remember && key) {
        prefs.remember(ctx.root, key, answer);
        note = ' — وحُفظ اختياره هذا في تفضيلاته فلا تسأل عنه ثانية';
      }
      return `اختار المستخدم: ${answer}${note}`;
    },
  },
  {
    // ذاكرة صريحة: تُستدعى حين يصرّح المستخدم بتفضيل دائم.
    // لا تُحفظ استنتاجات النموذج عنه — ما يقوله هو فقط، وبإذنه.
    name: 'remember',
    description: 'احفظ تفضيلًا دائمًا صرّح به المستخدم. مثال: {"key":"لغة التقارير","value":"العربية الفصحى"}',
    permission: 'ask',
    params: {
      key: { type: 'string', required: true },
      value: { type: 'string', required: true },
    },
    exec({ key, value }, { root }) {
      const saved = prefs.remember(root, key, value);
      return JSON.stringify({ remembered: saved.key, value: saved.value });
    },
  },
  {
    // إنشاء المهارات بالمحادثة يمرّ من هنا لا من write_file: مخزن كُنّاش
    // (.kunnash) ممنوع على الكتابة الحرة عمدًا — فيه الجلسات والنصوص
    // والمهملات. فبابٌ واحد مسمّى يفتح ما يجب وحده ويترك الباقي مغلقًا.
    name: 'save_skill',
    description: 'أنشئ أو حدّث مهارة أو عميلًا في مكتبة المستخدم. مثال: {"kind":"skill","id":"تقرير-الأسبوع","content":"---\nname: تقرير الأسبوع\ndescription: متى تُستخدم\n---\n# الخطوات\n..."}',
    permission: 'ask',
    params: {
      kind: { type: 'string', required: true, enum: ['skill', 'agent'] },
      id: { type: 'string', required: true, hint: 'اسم المجلد/الملف' },
      content: { type: 'string', required: true, hint: 'ماركداون بترويسة name وdescription' },
    },
    exec({ kind, id, content }, { root }) {
      if (!/^---\r?\n/.test(content)) {
        throw new Error('المحتوى يجب أن يبدأ بترويسة ‎---‎ فيها name وdescription — بدونها لا تظهر في الفهرس.');
      }
      library.saveItem(root, kind, id, content);
      return JSON.stringify({ saved: id, kind, path: `.kunnash/${kind}s/${id}` });
    },
  },
  {
    name: 'run_agent',
    description: 'كلّف عميلًا جانبيًا بمهمة وخذ نتيجته النهائية. مثال: {"agent_id":"reviewer","task":"راجع مخرجات/تقرير.md"}',
    permission: 'ask',
    params: {
      agent_id: { type: 'string', required: true },
      task: { type: 'string', required: true },
    },
    async exec({ agent_id, task }, ctx) {
      const body = library.readItem(ctx.root, 'agent', agent_id);
      if (!ctx.runNested) throw new Error('تشغيل العملاء غير متاح في هذا السياق.');
      // حلقة متداخلة ترث الحارس والبوابة والميزانية — النص النهائي فقط يرجع
      return await ctx.runNested({ agentBody: body, task });
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

module.exports = { TOOLS, TOOL_MAP, globToRegex, htmlToText, assertPublicUrl };
