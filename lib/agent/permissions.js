// بوابة الإذن — قواعد مخزَّنة بنطاق، لا تفويض مفتوح.
//
// المبدأ الحاكم (§٧): **لا تُخزَّن قاعدة أوسع من الطلب الذي ولّدها.**
// «اسمح دائمًا» على كتابةِ ملفٍ في «مخرجات/تقارير/» تصير قاعدةً لذلك المجلد
// وحده، لا لكل كتابة في كل مكان. هذا ميزان مكافحة الإرهاق دون فقد الأمان.
//
// ولماذا الإرهاق مسألة أمنية أصلًا: السؤال عن كل قراءة يُنتج ضجرًا يدفع
// المستخدم للضغط على «دائمًا» في كل شيء — وهذا يقتل البوابة أكثر من غيابها.
// فالقراءات حرة، والكتابة داخل مجلد المخرجات حرة (وتُعلَن عبر chat:tool)،
// وما عداهما يُسأل عنه.
//
// الصلاحية: قواعد الملفات بلا انتهاء، وقواعد الشبكة **٣٠ يومًا** — سماحٌ
// بائتٌ لنطاقٍ هو أحد قنوات الحقن الثلاث.

const fs = require('fs');
const path = require('path');

const { resolveInWorkspace } = require('../paths');

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file', 'render_document']);
const NET_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OUTPUTS_DIR = 'المخرجات';        // الكتابة داخله لا تُسأل — تُعلَن فقط

function storeFile(root) { return path.join(root, '.kunnash', 'permissions.json'); }

function load(root) {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(root), 'utf8'));
    const rules = Array.isArray(data.rules) ? data.rules : [];
    return rules.filter((r) => !r.expiresAt || r.expiresAt > Date.now());
  } catch { return []; }
}

function save(root, rules) {
  const f = storeFile(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ rules }, null, 1), 'utf8');
}

// ---------- اشتقاق النطاق من الاستدعاء نفسه ----------
function toPosix(rel) { return rel.split(path.sep).join('/'); }

/** مسارٌ ← نطاق مجلده: «تقارير/يوليو.md» ← «تقارير/**» */
function dirScope(root, p) {
  const { rel } = resolveInWorkspace(root, p);
  const dir = path.posix.dirname(toPosix(rel));
  return dir === '.' || dir === '' ? '**' : `${dir}/**`;
}

/** أضيق نطاقٍ يسع الجميع — الجذر المشترك، فإن لم يكن فـ«**» */
function commonScope(scopes) {
  const parts = scopes.map((s) => (s === '**' ? [] : s.slice(0, -3).split('/')));
  if (parts.some((p) => p.length === 0)) return '**';   // أحدها في الجذر
  let common = parts[0];
  for (const p of parts.slice(1)) {
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
    if (!common.length) return '**';
  }
  return `${common.join('/')}/**`;
}

/** يرجع { scope, kind } أو null إن تعذّر الاشتقاق (فلا يُعرض «دائمًا») */
function deriveScope(tool, args, root) {
  try {
    if (FILE_TOOLS.has(tool)) {
      const p = args.path || args.out_path;
      if (!p) return null;
      return { kind: 'file', scope: dirScope(root, p) };
    }
    // النقل يمسّ **طرفين**: مصدرًا وهدفًا. فنطاقه أضيق مجلدٍ يسع الطرفين
    // جميعًا — لا نطاق أول نقلة وحدها. وكان بلا اشتقاق إطلاقًا، فـ«السماح
    // دائمًا» عليه يمنح نقلًا غير محصور لبقية التشغيل: يوافق المستخدم على
    // خطةٍ في «تقارير/» فيصير كل شيء مباحًا. **إذنٌ أوسع مما رأى.**
    if (tool === 'move_files') {
      const moves = Array.isArray(args.moves) ? args.moves : [];
      if (!moves.length) return null;
      const scopes = [];
      for (const m of moves) {
        if (!m || !m.from || !m.to) return null;   // خطة ناقصة: لا نطاق يُشتق
        scopes.push(dirScope(root, m.from), dirScope(root, m.to));
      }
      return { kind: 'file', scope: commonScope(scopes) };
    }
    if (tool === 'fetch_url') {
      // الأصل فقط — لا `**` أبدًا: قاعدة لنطاق كامل بابُ حقنٍ مفتوح
      return { kind: 'net', scope: new URL(args.url).origin };
    }
    if (tool === 'run_agent') {
      return args.agent_id ? { kind: 'agent', scope: args.agent_id } : null;
    }
    if (tool === 'save_skill') {
      return args.kind ? { kind: 'library', scope: args.kind } : null;
    }
    if (tool === 'remember') return { kind: 'memory', scope: '*' };
  } catch { /* مسار أو رابط غير صالح — لا نطاق */ }
  return null;
}

// قاعدة مجلد `أ/ب/**` تغطي ما تحتها، والمساواة تكفي لغير الملفات
function scopeCovers(ruleScope, scope) {
  if (ruleScope === scope) return true;
  if (!ruleScope.endsWith('/**')) return ruleScope === '**' && scope.endsWith('/**');
  const base = ruleScope.slice(0, -2);          // «أ/ب/»
  return scope.startsWith(base);
}

/** هل يغطي المخزون هذا الاستدعاء؟ */
function isAllowed(root, tool, args) {
  const derived = deriveScope(tool, args, root);
  if (!derived) return false;
  return load(root).some((r) => r.tool === tool && scopeCovers(r.scope, derived.scope));
}

/** الكتابة داخل مجلد المخرجات مسموحة تلقائيًا — استثناء يحفظ التجربة */
function isInOutputs(tool, args, root) {
  if (tool !== 'write_file' && tool !== 'edit_file' && tool !== 'render_document') return false;
  try {
    const p = args.path || args.out_path;
    if (!p) return false;
    const { rel } = resolveInWorkspace(root, p);
    const first = toPosix(rel).split('/')[0];
    return first === OUTPUTS_DIR;
  } catch { return false; }
}

function remember(root, tool, args) {
  const derived = deriveScope(tool, args, root);
  if (!derived) return null;
  const rule = {
    tool,
    scope: derived.scope,
    kind: derived.kind,
    at: Date.now(),
    ...(derived.kind === 'net' ? { expiresAt: Date.now() + NET_TTL_MS } : {}),
  };
  const rules = load(root).filter((r) => !(r.tool === tool && r.scope === derived.scope));
  rules.push(rule);
  save(root, rules.slice(-60));
  return rule;
}

function revoke(root, tool, scope) {
  const rules = load(root);
  const kept = rules.filter((r) => !(r.tool === tool && r.scope === scope));
  if (kept.length === rules.length) return false;
  save(root, kept);
  return true;
}

// ---------- وصف القاعدة بلغة صاحبها ----------
// كان الوصف «delete_file في **» — اسمُ دالةٍ ورمزٌ لا يفهمهما إلا مبرمج،
// تحت **أخطر زرٍّ في التطبيق**. و«**» تعني «كل مساحة عملك إلى الأبد»، وهي
// الحالة الشائعة لا النادرة: أي ملفٍ في جذر المجلد يُنتجها. فالإفصاح كان
// قائمًا شكلًا غائبًا معنًى — والإذن الذي لا يُفهم توقيعٌ على بياض.
const TOOL_VERBS = {
  write_file: 'الكتابة في الملفات',
  edit_file: 'تعديل الملفات',
  delete_file: 'حذف الملفات إلى المهملات',
  render_document: 'إخراج المستندات',
  move_files: 'نقل الملفات',
  fetch_url: 'جلب الصفحات',
  run_agent: 'تكليف العميل',
  save_skill: 'الحفظ في مكتبتك',
  remember: 'حفظ تفضيلاتك',
};

/** «تقارير/**» ← «مجلد «تقارير» وما تحته» */
function describeScope(scope) {
  if (scope === '**') return 'كل مساحة عملك';
  if (scope === '*') return 'كل التفضيلات';
  if (scope.endsWith('/**')) return `مجلد «${scope.slice(0, -3)}» وما تحته`;
  return `«${scope}»`;
}

/** وصف عربي للقاعدة التي ستُحفظ — يُعرض على الزر قبل الضغط */
function describe(tool, scope, kind) {
  const verb = TOOL_VERBS[tool] || tool;
  if (kind === 'net') return `${verb} من «${scope}» (٣٠ يومًا)`;
  if (kind === 'file') return `${verb} في ${describeScope(scope)}`;
  if (kind === 'agent') return `${verb} «${scope}»`;
  if (kind === 'library') return `${verb} (${scope === 'skill' ? 'المهارات' : 'العملاء'})`;
  if (kind === 'memory') return verb;
  return `${verb} — ${scope}`;
}

module.exports = {
  load, remember, revoke, isAllowed, isInOutputs, deriveScope, describe,
  scopeCovers, OUTPUTS_DIR, NET_TTL_MS,
};
