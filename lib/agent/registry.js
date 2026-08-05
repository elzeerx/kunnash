// سجل الأدوات — المخططات والتحقق من الوسائط وإصلاح JSON.
//
// التحقق «متساهل مقصود» (جدول متانة م٣): النماذج تخطئ بأنماط معروفة —
// أرقام كنصوص، أسماء حقول مرادفة (path/file_path/filepath)، محتوى كمصفوفة —
// والقسر هنا يقتل صنفًا كاملًا من الأعطال بدل أن يعيد الجولة لكل هفوة.
// والخطأ حين يقع يُعاد كنص tool يفهمه النموذج، لا استثناءً يقتل التشغيل.

// مرادفات شائعة عبر النماذج — تُطبَّق قبل التحقق
const SYNONYMS = {
  path: ['file_path', 'filepath', 'filename', 'file', 'target'],
  content: ['text', 'contents', 'body', 'data'],
  old_text: ['old_string', 'old', 'search', 'find'],
  new_text: ['new_string', 'new', 'replace', 'replacement'],
  pattern: ['glob', 'name_pattern'],
  query: ['q', 'search', 'text'],
  url: ['uri', 'link', 'href'],
  items: ['todos', 'tasks', 'list'],
  id: ['skill_id', 'name', 'skill'],
  agent_id: ['agent', 'id', 'name'],
  task: ['prompt', 'instruction', 'request'],
};

function applySynonyms(spec, args) {
  const out = { ...args };
  for (const key of Object.keys(spec.params)) {
    if (out[key] !== undefined) continue;
    for (const alt of SYNONYMS[key] || []) {
      if (out[alt] !== undefined) { out[key] = out[alt]; break; }
    }
  }
  return out;
}

function coerce(type, v) {
  if (type === 'string') {
    if (typeof v === 'string') return v;
    // content كمصفوفة أسطر — نمط حقيقي من نماذج أضعف
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join('\n');
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return undefined;
  }
  if (type === 'number') {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return undefined;
  }
  if (type === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1' || v === 1) return true;
    if (v === 'false' || v === '0' || v === 0) return false;
    return undefined;
  }
  if (type === 'array') return Array.isArray(v) ? v : undefined;
  return undefined;
}

/** يتحقق ويقسر — يرجع { ok, value } أو { ok:false, error } نصًا للنموذج */
function validateArgs(spec, rawArgs) {
  if (rawArgs === null || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return { ok: false, error: `وسائط ${spec.name} يجب أن تكون كائن JSON. المخطط: ${schemaLine(spec)}` };
  }
  const args = applySynonyms(spec, rawArgs);
  const value = {};
  for (const [key, def] of Object.entries(spec.params)) {
    const v = args[key];
    if (v === undefined || v === null) {
      if (def.required) {
        return { ok: false, error: `الوسيط «${key}» مطلوب لأداة ${spec.name}. المخطط: ${schemaLine(spec)}` };
      }
      continue;
    }
    const c = coerce(def.type, v);
    if (c === undefined) {
      return { ok: false, error: `الوسيط «${key}» يجب أن يكون ${def.type}. المخطط: ${schemaLine(spec)}` };
    }
    if (def.enum && !def.enum.includes(c)) {
      return { ok: false, error: `«${key}» يقبل: ${def.enum.join(' | ')} فقط.` };
    }
    value[key] = c;
  }
  return { ok: true, value };
}

function schemaLine(spec) {
  return Object.entries(spec.params)
    .map(([k, d]) => `${k}${d.required ? '' : '?'}: ${d.enum ? d.enum.join('|') : d.type}`)
    .join(', ');
}

// ---------- إصلاح JSON الوسائط (العطل الأشيع في الجدول) ----------
function parseArgs(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: {} };
  if (typeof raw === 'object') return { ok: true, value: raw };
  let s = String(raw).trim();
  try { return { ok: true, value: JSON.parse(s) }; } catch { /* سلّم الإصلاح */ }

  // ١. نزع أسوار الماركداون
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return { ok: true, value: JSON.parse(s) }; } catch { /* التالي */ }

  // ٢. قصّ لأول { حتى أقواس متوازنة (يعالج نصًا زائدًا حول الكائن أو قطعًا مقصوصة)
  const start = s.indexOf('{');
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > start) {
      let cut = s.slice(start, end + 1);
      // ٣. حذف الفاصلة الأخيرة قبل الإغلاق
      cut = cut.replace(/,\s*([}\]])/g, '$1');
      try { return { ok: true, value: JSON.parse(cut) }; } catch { /* فشل نهائي */ }
    }
  }
  return { ok: false, error: 'وسائط الأداة ليست JSON صالحًا — أعد الاستدعاء بكائن JSON سليم.' };
}

// ---------- تقارب الأسماء (اسم مهلوس) ----------
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

function nearestTool(name, names) {
  let best = null, bestD = 3;
  for (const n of names) {
    const d = levenshtein(name, n);
    if (d < bestD) { best = n; bestD = d; }
  }
  return best;   // ≤2 فقط — اقتراح لا تنفيذ
}

// صيغة OpenAI للطلب — تُبنى مرة وتبقى مستقرة بايتًا ببايت (التخزين المؤقت)
function toOpenAiTools(specs) {
  return specs.map((s) => ({
    type: 'function',
    function: {
      name: s.name,
      description: s.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(s.params).map(([k, d]) => [k, {
          type: d.type === 'array' ? 'array' : d.type,
          ...(d.enum ? { enum: d.enum } : {}),
          ...(d.hint ? { description: d.hint } : {}),
          ...(d.type === 'array' ? { items: { type: 'string' } } : {}),
        }])),
        required: Object.entries(s.params).filter(([, d]) => d.required).map(([k]) => k),
      },
    },
  }));
}

module.exports = { validateArgs, parseArgs, nearestTool, toOpenAiTools, schemaLine, levenshtein };
