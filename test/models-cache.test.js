// ذاكرة قائمة النماذج — الاختيار لا يجب أن يكون رهنَ طلبِ شبكة.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ws = require('../lib/workspace');
const core = require('../lib/core');

let dir;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kunnash-models-'));
  ws.init(dir, null);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const OR = 'https://openrouter.ai/api/v1';
const AN = 'https://api.anthropic.com/v1';

describe('الحفظ والاسترجاع', () => {
  test('قبل أي جلب: لا قائمة — والواجهة تعرف أنها فارغة لا معطوبة', () => {
    const c = ws.loadModels(OR);
    assert.deepStrictEqual(c.models, []);
    assert.strictEqual(c.at, null);
  });

  test('ما يُحفظ يُسترجع بمعرّفه واسمه', () => {
    ws.saveModels(OR, [
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', extra: 'يُهمل' },
      { id: 'openai/gpt-5', name: 'GPT-5' },
    ]);
    const c = ws.loadModels(OR);
    assert.strictEqual(c.models.length, 2);
    assert.deepStrictEqual(c.models[0], { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' });
    assert.ok(c.at > 0);
  });

  test('لكل خدمة قائمتها — ولا تتسرّب إحداهما للأخرى', () => {
    ws.saveModels(AN, [{ id: 'claude-opus-4', name: 'Opus' }]);
    assert.strictEqual(ws.loadModels(AN).models.length, 1);
    assert.strictEqual(ws.loadModels(OR).models.length, 2, 'قائمة OpenRouter تغيّرت');
  });

  test('الحفظ لا يمحو المفتاح ولا النموذج المحفوظين للخدمة', () => {
    ws.saveConnection({ baseUrl: OR, apiKey: 'sk-test', model: 'openai/gpt-5' });
    ws.saveModels(OR, [{ id: 'x', name: 'X' }]);
    const conn = ws.loadConnection();
    assert.strictEqual(conn.apiKey, 'sk-test', 'ضاع المفتاح عند حفظ القائمة');
    assert.strictEqual(conn.model, 'openai/gpt-5', 'ضاع النموذج');
  });

  // العطب الذي شكا منه المستخدم: يحدّث القائمة ثم يفتح الإعدادات فلا يجدها.
  // المفتاح الذي يُحفظ به يجب أن يكون **نفسه** الذي يُقرأ به.
  test('ما يحفظه مسار التحديث يقرؤه مسار الفتح بالمفتاح نفسه', () => {
    ws.saveConnection({ baseUrl: OR });
    const atSave = core.loadConnection().baseUrl;     // ما يستعمله معالج التحديث
    ws.saveModels(atSave, [{ id: 'a/b', name: 'A' }, { id: 'c/d', name: 'C' }]);
    const atRead = core.loadConnection().baseUrl;     // ما يستعمله معالج الفتح
    assert.strictEqual(ws.loadModels(atRead).models.length, 2,
      'المفتاحان مختلفان — تُحفظ القائمة ولا تُقرأ');
  });

  test('العنوان الفارغ يرتدّ إلى الافتراضي لا إلى مفتاح ثالث', () => {
    const c1 = ws.loadModels(undefined);
    const c2 = ws.loadModels(core.loadConnection().baseUrl);
    assert.deepStrictEqual(c1.models, c2.models);
  });
});
