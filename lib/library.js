// مكتبة العملاء والمهارات — ملفات في مساحة العمل
// العملاء: .kunnash/agents/<id>.md — المهارات: .kunnash/skills/<id>/SKILL.md
//
// القراءة تقبل مساحات العمل القائمة التي مهاراتها في .claude/ (نمط Claude Code)
// فلا تحتاج هجرة — لكن الكتابة تذهب دائمًا إلى .kunnash/ ولا نمسّ .claude/ أبدًا.

const fs = require('fs');
const path = require('path');

const { resolveInWorkspace, writeFileGuarded } = require('./paths');

// المعرّف اسمُ مجلد يكتبه المستخدم ويشاركه. القاعدة القديمة كانت لاتينية فقط،
// وهذا يجعل «مهارة عربية» تظهر في القائمة (لأن العرض يقرأ القرص) ثم ترفض
// القراءة والحذف فتحها — تعارضٌ يراه المستخدم عطلًا. فالقاعدة الآن أمنية لا
// إملائية: ما يمنع اجتياز المسار وما يكسر الواجهة، لا أكثر.
//   • بلا فاصل مسار ولا بايت صفري ولا محارف تحكّم
//   • لا يبدأ بنقطة (‎.kunnash‎ و‎.git‎ ليست مهارات)
//   • بلا ‎|‎ لأن قائمة التفعيل تفصل بها
//   • بلا مسافات على الطرفين، وطول معقول
const ID_FORBIDDEN = /[/\\\0|\u0000-\u001f\u007f]/;

function validId(id) {
  return typeof id === 'string'
    && id.length >= 1 && id.length <= 60
    && id === id.trim()
    && !id.startsWith('.')
    && !ID_FORBIDDEN.test(id);
}

// المكتبة تكتب في ‎.kunnash/‎ وهو ممنوع على أدوات النموذج — فهي مالكة ذلك
// المجلد لا زائرة عليه. لذلك تستدعي الحارس للاحتواء وحده بلا ‎forWrite‎:
// المطلوب هنا التأكد أن المسار لم يُخدَع برابط رمزي، لا إعادةُ منع ما تملكه.
function guard(root, abs) {
  return resolveInWorkspace(root, abs).abs;
}

function dirs(root) {
  return {
    agent: path.join(root, '.kunnash', 'agents'),
    skill: path.join(root, '.kunnash', 'skills'),
  };
}

// مجلدات القراءة بالترتيب: مخزن كُنّاش أولًا ثم الاحتياطي
function readDirs(root) {
  return [
    dirs(root),
    { agent: path.join(root, '.claude', 'agents'), skill: path.join(root, '.claude', 'skills') },
  ];
}

// الوصف هو ما يبني الفهرس ويشغّل المحفّز — فقراءتُه ناقصةً تُعطّل المهارة
// بصمت. وكثير من المهارات المكتوبة بعناية تكتب وصفها بمقياس YAML المطويّ
// (`description: >` ثم أسطر مُزاحة)، وقراءةُ السطر الواحد تُخرج «>» وحدها:
// تظهر المهارة في القائمة بوصفٍ فارغ ولا تنطلق بمحفّز أبدًا — ولا يدري
// صاحبها أنها أُهملت. فتُقرأ الكتلة المُزاحة كاملة وتُطوى إلى سطر.
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = { name: '', description: '' };
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    // مقياس مطويّ (>) أو حرفيّ (|) — بلاحقة chomping اختيارية
    if (/^[|>][+-]?$/.test(value)) {
      const body = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && !/^\s/.test(lines[j])) break;   // انتهت الإزاحة
        body.push(lines[j].trim());
        i = j;
      }
      out[key] = body.join(value[0] === '>' ? ' ' : '\n').trim();
    } else {
      // نزع الاقتباس المحيط إن وُجد — يكتبه بعضهم ولا يقصده جزءًا من النصّ
      out[key] = value.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
    }
  }
  return out;
}

function itemPath(root, type, id, d = dirs(root)) {
  if (!validId(id)) throw new Error('معرّف غير صالح — بلا شرطة مائلة ولا نقطة في أوله (مثل: monthly-report أو «تقرير-الأسبوع»)');
  if (type === 'agent') return path.join(d.agent, id + '.md');
  if (type === 'skill') return path.join(d.skill, id, 'SKILL.md');
  throw new Error('نوع غير معروف');
}

function listLibrary(root) {
  const agents = new Map();
  const skills = new Map();

  // الأسبق يفوز: ما في .kunnash يحجب ما يحمل نفس المعرّف في .claude
  for (const d of readDirs(root)) {
    if (fs.existsSync(d.agent)) {
      for (const f of fs.readdirSync(d.agent)) {
        if (!f.endsWith('.md')) continue;
        const id = f.replace(/\.md$/, '');
        if (agents.has(id)) continue;
        const fm = parseFrontmatter(fs.readFileSync(path.join(d.agent, f), 'utf8'));
        agents.set(id, { id, type: 'agent', name: fm.name || id, description: fm.description });
      }
    }
    if (fs.existsSync(d.skill)) {
      for (const sub of fs.readdirSync(d.skill)) {
        if (skills.has(sub)) continue;
        const file = path.join(d.skill, sub, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        skills.set(sub, { id: sub, type: 'skill', name: fm.name || sub, description: fm.description });
      }
    }
  }
  return { agents: [...agents.values()], skills: [...skills.values()] };
}

function readItem(root, type, id) {
  for (const d of readDirs(root)) {
    const file = guard(root, itemPath(root, type, id, d));
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  throw new Error(`لا يوجد ${type === 'agent' ? 'عميل' : 'مهارة'} بالمعرّف «${id}»`);
}

function saveItem(root, type, id, content) {
  const file = guard(root, itemPath(root, type, id));
  writeFileGuarded(file, content);
  return true;
}

function deleteItem(root, type, id) {
  const file = guard(root, itemPath(root, type, id));
  if (!fs.existsSync(file)) {
    // موجود في .claude/ الاحتياطي؟ نعرضه ولا نحذفه — لسنا مالكي ذلك المجلد
    const legacy = itemPath(root, type, id, readDirs(root)[1]);
    if (fs.existsSync(legacy)) {
      throw new Error('هذا العنصر محفوظ في مجلد .claude ولا يحذفه كُنّاش — احذفه بنفسك إن أردت.');
    }
    return false;
  }
  if (type === 'skill') fs.rmSync(path.dirname(file), { recursive: true });
  else fs.rmSync(file);
  return true;
}

const AGENT_TEMPLATE = `---
name: {{ID}}
description: (متى يُستدعى هذا العميل؟ اكتب وصفًا يحدد حالات الاستخدام بوضوح)
---

أنت (دور العميل) — (صف مجال عمله في سطر).

## قواعدك

1. (أضف قواعد العميل هنا)
2. (وقاعدة ثانية)

## صيغة المخرج

(حدد شكل النتيجة المتوقعة)
`;

const SKILL_TEMPLATE = `---
name: {{ID}}
description: (متى تُستخدم هذه المهارة؟ اذكر عبارات الاستدعاء مثل «سوّ لي كذا»)
---

# (عنوان المهارة)

## الخطوات

1. (الخطوة الأولى)
2. (الخطوة الثانية)

## القواعد

- (ما يجب الالتزام به في المخرج)
`;

function templateFor(type, id) {
  const t = type === 'agent' ? AGENT_TEMPLATE : SKILL_TEMPLATE;
  return t.replace('{{ID}}', id);
}

module.exports = { listLibrary, readItem, saveItem, deleteItem, templateFor, validId };
