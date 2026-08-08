// الاتجاه ثنائي اللغة — قرار واحد في موضع واحد.
//
// المشكلة التي يحلّها: جملة عربية فيها كلمات إنجليزية يجب أن تبقى **يمينية
// كاملة**، وتُرسم الكلمات الإنجليزية داخلها يسارًا في موضعها بلا أن تقلب
// الجملة. وخوارزمية Unicode للاتجاه تفعل هذا وحدها **بشرط أن يكون اتجاه
// الأساس صحيحًا** — وهنا يقع الخطأ عادةً.
//
// لماذا لا نكتفي بـ dir="auto":
//   dir="auto" يأخذ الاتجاه من **أول حرف قويّ**. فجملة «React هو مكتبة
//   لبناء الواجهات» تبدأ بحرف لاتيني، فيصير أساسها يساريًا، فتنقلب الجملة
//   العربية كلها. وهذا بالضبط العطب الذي يراه المستخدم.
//
// فالمعتمد: **الغلبة بعدد الكلمات** من كل اتجاه، ويفوز الأكثر.
// «React هو مكتبة لبناء الواجهات» ← كلمة لاتينية مقابل أربع عربية ← يمينية. ✓
// «Kunnash is a macOS app» ← لاتينية خالصة ← يسارية. ✓
//
// ولماذا لكل فقرة اتجاهها لا للرسالة كلها: ردٌّ واحد قد يحمل فقرة عربية
// وفقرة إنجليزية وسطرَ شيفرة. اتجاهٌ واحد مفروض على الجميع يُفسد اثنين منها.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.bidi = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // الحروف القوية يمينًا: عربي وفارسي وأردي وعبري ومتفرقاتها وأشكال العرض
  const RTL = /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿ࢠ-ࣿיִ-﷿ﹰ-﻿]+/g;
  // الحروف القوية يسارًا: لاتيني بامتداداته ويوناني وكيريلي
  const LTR = /[A-Za-zÀ-ʯͰ-ϿЀ-ӿ]+/g;

  // نعدّ **الكلمات** لا الحروف. العدّ بالحروف يظلم العربية ظلمًا منهجيًا:
  // «افتح الملف» تسعة أحرف و«open the file» أحد عشر، والمعنى واحد — لأن
  // العربية تُسقط الحركات. فجملة عربية قصيرة فيها مصطلح لاتيني واحد قد
  // تُحسب يسارية بالحروف وهي عربية بالمعنى. وعدّ الكلمات يزيل التحيّز.
  const runs = (text, re) => { const m = String(text).match(re); return m ? m.length : 0; };

  /**
   * اتجاه أساس النص بالغلبة.
   * @returns {'rtl'|'ltr'|null} وnull للنص المحايد (أرقام وترقيم وحدها) فيرث اتجاه أبيه
   */
  function baseDir(text) {
    const s = String(text || '');
    if (!s.trim()) return null;
    const rtl = runs(s, RTL);
    const ltr = runs(s, LTR);
    if (!rtl && !ltr) return null;
    // التساوي يرجّح اليمين: التطبيق عربي الأصل، والمتساوي غالبًا عربيٌّ
    // تتخلله مصطلحات لاتينية لا العكس.
    return rtl >= ltr ? 'rtl' : 'ltr';
  }

  // العناصر التي تُعامل كفقرات مستقلة: لكلٍّ اتجاهه من نصّه هو.
  // blockquote منها عمدًا: المسودة الإنجليزية داخل بطاقة عربية يجب أن يقع
  // خطّها على يسارها مع نصّها — والحدّ المنطقي يتبع اتجاه العنصر نفسه لا أبيه.
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, blockquote';

  /**
   * يضبط اتجاه كل فقرة داخل شجرة معروضة.
   * لا يلمس pre (الشيفرة يسارية دائمًا) ولا يفرض شيئًا على المحايد.
   */
  function applyDir(rootEl) {
    if (!rootEl) return rootEl;
    for (const el of rootEl.querySelectorAll(BLOCKS)) {
      if (el.closest('pre')) continue;
      const d = baseDir(el.textContent);
      if (d) el.setAttribute('dir', d);
    }
    // الجذر نفسه إن كان يحمل نصًّا مباشرًا بلا فقرات
    if (!rootEl.querySelector(BLOCKS)) {
      const d = baseDir(rootEl.textContent);
      if (d) rootEl.setAttribute('dir', d);
    }
    isolateInline(rootEl);
    return rootEl;
  }

  /**
   * عزل المقاطع المضمّنة (شيفرة، روابط، أسماء ملفات).
   *
   * المشكلة: الترقيم والأقواس **محايدة**، فإذا وقعت بين مقطعين مختلفي
   * الاتجاه التصقت بالخطأ — فيصير `(config.json)` داخل جملة عربية
   * «config.json)‏(» . والعزل يجعل كل مقطع جزيرة مستقلة لا تسري
   * حدودها على جيرانها.
   */
  function isolateInline(rootEl) {
    for (const el of rootEl.querySelectorAll('code, a, .file-link')) {
      if (el.tagName === 'CODE' && el.parentElement && el.parentElement.tagName === 'PRE') continue;
      const d = baseDir(el.textContent);
      el.setAttribute('dir', d || 'ltr');   // المحايد (مسار، رقم، رمز) يسارًا
      el.classList.add('bidi-isolate');
    }
  }

  /** نصّ خام في عنصر واحد — لرسالة المستخدم وأسماء الملفات والعناوين */
  function setDir(el, text) {
    if (!el) return el;
    const d = baseDir(text != null ? text : el.textContent);
    if (d) el.setAttribute('dir', d);
    return el;
  }

  return { baseDir, applyDir, setDir, isolateInline };
});
