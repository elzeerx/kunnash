// حلقة الأدوات — قلب م٣.
//
// القواعد الأربع الحاسمة (لا استثناء لواحدة منها):
//   ١. لا اعتماد على finish_reason: وجود استدعاءات مجمّعة يحسم — بعض
//      المزوّدين يرسلون "stop" مع أدوات.
//   ٢. لكل tool_call_id رسالة tool مقابلة دائمًا: اسم مهلوس، رفض مستخدم،
//      خطأ تحليل، تجاوز ميزانية — كلها تمر بـcloseToolCall الواحدة، بلا
//      مسار خروج بديل. تسريب هذا الثابت يجعل الطلب التالي 400.
//   ٣. النص يُبثّ من كل جولة ولا يُسقط أبدًا.
//   ٤. التنفيذ تسلسلي — مربع الإذن مشروط وترتيب الكتابة مهم.
//
// الإلغاء عبر AbortSignal ونتيجته اكتمالٌ بالنص المتراكم لا خطأ —
// لئلا يضيع عمل نصف ساعة.

const { streamRound } = require('../connection');
const { TOOLS, TOOL_MAP } = require('./tools');
const { validateArgs, parseArgs, nearestTool, toOpenAiTools } = require('./registry');
const permissions = require('./permissions');

// الحدود (§٦) — قابلة للتمرير للاختبار وللضبط لاحقًا
const DEFAULT_LIMITS = {
  rounds: 24,
  toolCalls: 60,
  tokens: 400000,
  costUsd: 0.5,
  timeMs: 10 * 60 * 1000,
};

class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}

/**
 * تشغيل واحد للحلقة.
 *
 * @param {object} o
 * @param {object}   o.cfg           إعداد الاتصال (عنوان/نموذج/مفتاح/سياسة)
 * @param {Array}    o.messages      النص الكامل بلا رسالة النظام — يُعدَّل بالمكان
 * @param {Array}    o.systemMessages رسائل النظام (تُبنى مرة، مستقرة بايتًا)
 * @param {object}   o.ctx           سياق الأدوات { root, runNested? }
 * @param {Function} o.onDelta       (chunk)
 * @param {Function} o.onTool        (name, input)
 * @param {Function} o.onPermission  (request) → 'allow'|'always'|'deny'
 * @param {AbortSignal} [o.signal]
 * @param {object}   [o.limits]
 * @param {object}   [o.budget]      ميزانية مشتركة (حلقة متداخلة ترث الأم)
 * @param {boolean}  [o.noTools]     دردشة عادية بلا أدوات
 * @returns {{ text, usage, stopReason }}
 */
async function runLoop(o) {
  const limits = { ...DEFAULT_LIMITS, ...(o.limits || {}) };
  const budget = o.budget || { calls: 0, tokens: 0, cost: 0, start: Date.now() };
  const openAiTools = o.noTools ? null : toOpenAiTools(TOOLS);

  let fullText = '';
  let stopReason = 'done';
  let toolChoiceOverride = null;      // 'none' جولة واحدة بعد دوران/فشل متتالٍ
  let consecutiveFailures = 0;
  let parseFailures = 0;
  const fingerprints = new Map();     // اسم+وسائط ← عدّاد (كشف الدوران)
  const alwaysAllowed = new Set();    // «اسمح دائمًا» لعمر التشغيل (قواعد م٤ لاحقًا)
  let noTools = Boolean(o.noTools);

  const emitText = (chunk) => { fullText += chunk; if (o.onDelta) o.onDelta(chunk); };

  for (let round = 1; ; round++) {
    if (o.signal && o.signal.aborted) { stopReason = 'cancelled'; break; }
    if (round > limits.rounds) { stopReason = 'rounds'; break; }
    if (Date.now() - budget.start > limits.timeMs) { stopReason = 'time'; break; }
    if (budget.tokens > limits.tokens) { stopReason = 'tokens'; break; }
    if (budget.cost > limits.costUsd) { stopReason = 'cost'; break; }

    let res;
    try {
      res = await streamRound({
        cfg: o.cfg,
        messages: [...o.systemMessages, ...o.messages],
        tools: noTools ? null : openAiTools,
        toolChoice: toolChoiceOverride || 'auto',
        onDelta: emitText,
        signal: o.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') { stopReason = 'cancelled'; break; }
      // نموذج لا يعرف حقل tools؟ (400 يذكر tool) — ننزل لدردشة عادية ونكمل
      if (!noTools && /tool/i.test(String(err.message)) && /400|غير|فشل/.test(String(err.message))) {
        noTools = true;
        emitText('\n(هذا النموذج لا يدعم الأدوات — أُكمل كدردشة عادية بلا وصول للملفات.)\n');
        continue;
      }
      throw err;
    }
    toolChoiceOverride = null;

    if (res.usage) {
      budget.tokens += (res.usage.prompt_tokens || 0) + (res.usage.completion_tokens || 0);
      budget.cost += res.usage.cost || 0;
    } else {
      // مزوّد بلا usage: تقدير خشن يكفي لفرملة الميزانية
      budget.tokens += Math.ceil((JSON.stringify(o.messages).length + res.text.length) / 3);
    }

    // انقطاع وسط البث: نغلق الجولة بما وصل ونطلب من جديد بالنص المتراكم —
    // الاستدعاءات المجمّعة قد تكون مقصوصة فلا تُغذّى (قاعدة finish length)
    if (res.interrupted) {
      if (res.text) o.messages.push({ role: 'assistant', content: res.text });
      o.messages.push({ role: 'user', content: '(انقطع البث — أكمل من حيث توقفت بلا تكرار ما كتبته)' });
      continue;
    }

    // القاعدة ١: الاستدعاءات المجمّعة تحسم لا finish_reason
    const calls = res.toolCalls;
    if (!calls.length) {
      if (res.finishReason === 'length' && round < limits.rounds) {
        o.messages.push({ role: 'assistant', content: res.text });
        o.messages.push({ role: 'user', content: '(بلغتَ حد الطول — أكمل)' });
        continue;
      }
      // الرد النهائي يدخل النص المحفوظ — بدونه تفقد الذاكرة كل أجوبة النموذج
      if (res.text) o.messages.push({ role: 'assistant', content: res.text });
      stopReason = 'done';
      break;
    }

    // القاعدة (finish length مع استدعاءات): الوسائط مقصوصة — لا تُغذَّ
    if (res.finishReason === 'length') {
      if (res.text) o.messages.push({ role: 'assistant', content: res.text });
      o.messages.push({ role: 'user', content: '(انقطع الاستدعاء في منتصفه لطول الرد — أعد استدعاء الأداة كاملًا)' });
      continue;
    }

    // معرّفات مفقودة/مكررة → نولّد call_<round>_<index>
    const seen = new Set();
    calls.forEach((c, i) => {
      if (!c.id || seen.has(c.id)) c.id = `call_${round}_${i}`;
      seen.add(c.id);
    });

    // ادفع رسالة المساعد بمحتواها النصي وبكل الاستدعاءات
    o.messages.push({
      role: 'assistant',
      content: res.text || '',
      tool_calls: calls.map((c) => ({
        id: c.id, type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      })),
    });

    // القاعدة ٢: closeToolCall — الطريق الوحيد لإنهاء أي استدعاء
    const closeToolCall = (call, content) => {
      o.messages.push({ role: 'tool', tool_call_id: call.id, content: String(content) });
    };

    let budgetHit = null;
    for (const call of calls) {
      if (o.signal && o.signal.aborted) { closeToolCall(call, '(أُلغي التشغيل قبل تنفيذ هذه الأداة)'); stopReason = 'cancelled'; continue; }
      if (budgetHit) { closeToolCall(call, budgetHit); continue; }
      budget.calls++;
      if (budget.calls > limits.toolCalls) {
        budgetHit = `(بلغ التشغيل حد ${limits.toolCalls} استدعاء — اختم بما لديك)`;
        closeToolCall(call, budgetHit);
        continue;
      }

      // اسم مهلوس؟
      const spec = TOOL_MAP.get(call.name);
      if (!spec) {
        const near = nearestTool(call.name, [...TOOL_MAP.keys()]);
        closeToolCall(call, `لا توجد أداة «${call.name}». المتاح: ${[...TOOL_MAP.keys()].join('، ')}.` +
          (near ? ` أتقصد «${near}»؟` : ''));
        consecutiveFailures++;
        continue;
      }

      // تحليل الوسائط بسلّم الإصلاح
      const parsed = parseArgs(call.args);
      if (!parsed.ok) {
        parseFailures++;
        if (parseFailures > 2) {
          closeToolCall(call, 'تكرر فشل JSON — توقف عن استدعاء الأدوات واشرح ما تحاول فعله نصًا.');
          toolChoiceOverride = 'none';
          continue;
        }
        closeToolCall(call, parsed.error);
        consecutiveFailures++;
        continue;
      }
      const valid = validateArgs(spec, parsed.value);
      if (!valid.ok) {
        closeToolCall(call, valid.error);
        consecutiveFailures++;
        continue;
      }

      // كشف الدوران: نفس الاسم وبصمة الوسائط ٣ مرات
      const fp = call.name + '|' + JSON.stringify(valid.value);
      const times = (fingerprints.get(fp) || 0) + 1;
      fingerprints.set(fp, times);
      if (times >= 3) {
        closeToolCall(call, '(تكرار: استدعيت هذه الأداة بنفس الوسائط ثلاث مرات — النتيجة لن تتغير. اختم بما لديك)');
        toolChoiceOverride = 'none';
        continue;
      }

      // بوابة الإذن — التصنيف بالأثر (§٧)، وثلاثة أبواب تسبق السؤال:
      //   ١. الكتابة داخل مجلد المخرجات: مسموحة وتُعلَن عبر chat:tool فقط.
      //   ٢. قاعدة مخزَّنة تغطي هذا النطاق بالضبط.
      //   ٣. «دائمًا» في هذا التشغيل (حين يتعذّر اشتقاق نطاق يُحفظ).
      if (spec.permission === 'ask' && !alwaysAllowed.has(spec.name)) {
        const root = o.ctx && o.ctx.root;
        const preApproved = root && (
          permissions.isInOutputs(spec.name, valid.value, root) ||
          permissions.isAllowed(root, spec.name, valid.value)
        );
        if (!preApproved) {
          const derived = root ? permissions.deriveScope(spec.name, valid.value, root) : null;
          const decision = await o.onPermission({
            toolName: spec.name,
            title: `يريد النموذج استخدام ${spec.name}`,
            input: valid.value,
            // ما ستحفظه «دائمًا» بالضبط — يُعرض على الزر قبل الضغط، فلا
            // يوقّع المستخدم على بياض
            alwaysScope: derived ? permissions.describe(spec.name, derived.scope, derived.kind) : null,
          });
          if (decision === 'always') {
            if (derived && root) permissions.remember(root, spec.name, valid.value);
            else alwaysAllowed.add(spec.name);   // بلا نطاق يُحفظ: لهذا التشغيل
          } else if (decision !== 'allow') {
            closeToolCall(call, 'رفض المستخدم هذا الإجراء — تكيّف أو اقترح بديلًا.');
            continue;
          }
        }
      }

      if (o.onTool) o.onTool(spec.name, valid.value);

      // التنفيذ — تسلسلي، والخطأ محتوى tool لا استثناء
      try {
        const result = await spec.exec(valid.value, o.ctx);
        closeToolCall(call, result === undefined || result === '' ? '(تم بلا مخرجات)' : result);
        consecutiveFailures = 0;
      } catch (err) {
        closeToolCall(call, `خطأ: ${String(err && err.message || err)}`);
        consecutiveFailures++;
      }
    }

    if (stopReason === 'cancelled') break;

    // فشل متتالٍ ٣ ← جولة شرح بلا أدوات بدل الاستمرار أعمى
    if (consecutiveFailures >= 3) {
      toolChoiceOverride = 'none';
      consecutiveFailures = 0;
    }
  }

  // خاتمة حدود الميزانية: يقال للمستخدم لماذا توقف — لا صمت
  const closers = {
    rounds: '\n\n(توقف: بلغ التشغيل حد الجولات)',
    time: '\n\n(توقف: تجاوز التشغيل حد الوقت)',
    tokens: '\n\n(توقف: تجاوز التشغيل حد الرموز)',
    cost: '\n\n(توقف: تجاوز التشغيل حد الكلفة)',
  };
  if (closers[stopReason]) emitText(closers[stopReason]);

  return {
    text: fullText,
    stopReason,
    usage: { tokens: budget.tokens, cost: budget.cost, calls: budget.calls },
  };
}

module.exports = { runLoop, DEFAULT_LIMITS, Cancelled };
