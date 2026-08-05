// النص المحفوظ — ذاكرة الحلقة بين التشغيلات، والتقليم قبل كل طلب.
//
// الحيلة المعمارية (م٣): sessionId نولّده نحن، والنص الكامل (برسائل الأدوات)
// يعيش في <مساحة العمل>/.kunnash/transcripts/<id>.json — فالاستئناف يعمل عبر
// الأجهزة لأن الذاكرة في مساحة العمل لا في الجهاز.
//
// قاعدة لا تُكسر: لا تُسقَط رسالة tool دون إسقاط رسالة المساعد الحاملة
// لاستدعائها — «الخطأ الأول في كل حلقة مكتوبة يدويًا». لذلك وحدة التقليم
// «كتلة»: رسالة مستخدم مفردة، أو مساعدٌ مع كل رسائل tool التابعة له.

const fs = require('fs');
const path = require('path');

function transcriptPath(root, sessionId) {
  return path.join(root, '.kunnash', 'transcripts', sessionId + '.json');
}

function load(root, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(transcriptPath(root, sessionId), 'utf8')).messages || [];
  } catch { return null; }
}

function save(root, sessionId, messages) {
  const file = transcriptPath(root, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ messages }, null, 1), 'utf8');
}

// تقدير رموز خشن يكفي لقرارات التقليم — العربية أكثف من ٤ أحرف/رمز
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content || '').length;
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 3);
}

// تقسيم لرسائل كتل لا تنفصل
function toBlocks(messages) {
  const blocks = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      const block = [m];
      i++;
      while (i < messages.length && messages[i].role === 'tool') { block.push(messages[i]); i++; }
      blocks.push(block);
    } else {
      blocks.push([m]);
      i++;
    }
  }
  return blocks;
}

const EVICT_STUB = (name, lines) => `(نتيجة ${name || 'أداة'} — ${lines} سطرًا، أُزيلت لتوفير السياق. أعد الاستدعاء إن احتجتها.)`;

/**
 * يقلّم نصًا للإرسال:
 *  ١. إخلاء نتائج الأدوات في الكتل الأقدم من آخر keepToolBlocks كتل أدوات —
 *     البنية تبقى صحيحة (كل tool_call_id له رد) ويذهب معظم التضخم بلا نموذج.
 *  ٢. إن بقي فوق الحد: نافذة منزلقة برأس مثبّت — أول رسالة مستخدم + آخر الكتل.
 */
function prune(messages, { maxTokens = 60000, keepToolBlocks = 2 } = {}) {
  let blocks = toBlocks(messages);

  // ١. الإخلاء
  const toolBlockIdx = blocks.map((b, i) => (b.length > 1 ? i : -1)).filter((i) => i >= 0);
  const evictBefore = toolBlockIdx.slice(0, Math.max(0, toolBlockIdx.length - keepToolBlocks));
  for (const bi of evictBefore) {
    const callNames = new Map((blocks[bi][0].tool_calls || []).map((c) => [c.id, c.function && c.function.name]));
    for (let j = 1; j < blocks[bi].length; j++) {
      const t = blocks[bi][j];
      const lines = String(t.content || '').split('\n').length;
      if (String(t.content || '').length > 200) {
        blocks[bi][j] = { ...t, content: EVICT_STUB(callNames.get(t.tool_call_id), lines) };
      }
    }
  }

  // ٢. النافذة المنزلقة
  let flat = blocks.flat();
  if (estimateTokens(flat) <= maxTokens) return flat;

  const firstUserIdx = blocks.findIndex((b) => b[0].role === 'user');
  const head = firstUserIdx >= 0 ? [blocks[firstUserIdx]] : [];
  let tail = blocks.slice(firstUserIdx + 1);
  while (tail.length > 1 && estimateTokens([...head, ...tail].flat()) > maxTokens) {
    tail = tail.slice(1);
  }
  // لو بدأ الذيل برسائل tool يتيمة (لا يقع مع كتلنا — دفاع إضافي)
  while (tail.length && tail[0][0].role === 'tool') tail = tail.slice(1);
  return [...head, ...tail].flat();
}

/** فحص الثابت: كل tool تسبقها رسالة مساعد تحمل نفس tool_call_id */
function checkInvariant(messages) {
  let pending = new Set();
  for (const m of messages) {
    if (m.role === 'assistant') {
      pending = new Set((m.tool_calls || []).map((c) => c.id));
    } else if (m.role === 'tool') {
      if (!pending.has(m.tool_call_id)) return false;
    }
  }
  return true;
}

module.exports = { load, save, prune, estimateTokens, checkInvariant, transcriptPath };
