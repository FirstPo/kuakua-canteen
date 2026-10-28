'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ENGINE_VERSION,
  BREAKDOWN_META,
  scorePraise,
  gradeFor,
  effectiveLength,
  normalizeForMatch,
  similarity
} = require('../shared/praise-score');

const STRONG = '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。';
const GENERIC = '你做的饭真的很好吃，这道菜味道不错，口感很好，色泽也好看，你真的很会做饭，做得很好，我吃得很开心，下次还想吃。';
const SPECIFIC_SHORT = '你炒的青椒肉丝真香，火候刚刚好。';

test('短句直接触犯最低字数，分数封顶', () => {
  const result = scorePraise('你做的饭真好吃');
  assert.equal(result.passed, false);
  assert.ok(result.hardFail.indexOf('too_short') >= 0);
  assert.ok(result.score <= 49);
  assert.equal(result.length, 7);
  assert.ok(result.suggestions.length > 0);
});

test('泛泛而谈的长句也过不了线', () => {
  const result = scorePraise(GENERIC);
  assert.equal(result.passed, false);
  assert.ok(result.score < 80);
  assert.ok(result.length >= 20);
});

test('具体、走心、提到菜品的夸奖可以过线', () => {
  const result = scorePraise(STRONG, { dishNames: ['油泼面'] });
  assert.equal(result.passed, true);
  assert.ok(result.score >= 80);
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.equal(result.hardFail.length, 0);
  assert.ok(result.breakdown.specificity >= 12);
  assert.ok(result.breakdown.emotion >= 12);
  assert.ok(result.breakdown.length > 0);
});

test('具体但太短，仍然被打回', () => {
  const result = scorePraise(SPECIFIC_SHORT);
  assert.equal(result.passed, false);
  assert.ok(result.hardFail.indexOf('too_short') >= 0);
});

test('和上一轮几乎一样会触发重复硬伤，改标点也没用', () => {
  const same = scorePraise(STRONG, { previousTexts: [STRONG] });
  assert.equal(same.passed, false);
  assert.ok(same.hardFail.indexOf('duplicate') >= 0);
  assert.ok(same.similarity >= 0.92);
  assert.ok(same.score <= 49);

  const punctuationChanged = STRONG.replace(/，/g, '。').replace(/。/g, '！');
  const changed = scorePraise(punctuationChanged, { previousTexts: [STRONG] });
  assert.equal(changed.passed, false);
  assert.ok(changed.hardFail.indexOf('duplicate') >= 0);
});

test('纯表情、复读、刷屏、标点灌水都会被识别', () => {
  const emoji = scorePraise('👍👍👍👍👍👍👍👍👍👍');
  assert.ok(emoji.hardFail.indexOf('emoji_spam') >= 0);
  assert.equal(emoji.length, 0);

  const repeat = scorePraise('好吃好吃好吃好吃好吃');
  assert.ok(repeat.hardFail.indexOf('low_variety') >= 0);

  const run = scorePraise('好好好好好好好好好好');
  assert.ok(run.hardFail.indexOf('spam_run') >= 0);

  const punct = scorePraise('你做的饭真好吃真好吃真好吃！！！！！！！！！！！！');
  assert.ok(punct.hardFail.indexOf('spam_punctuation') >= 0);
});

test('提到菜品会加具体分，情感词会加走心分', () => {
  const withDish = scorePraise('油泼面真香', { dishNames: ['油泼面'] });
  const withoutDish = scorePraise('这个真香');
  assert.ok(withDish.breakdown.specificity > withoutDish.breakdown.specificity);

  const cold = scorePraise('这道菜的火候不错，切得也整齐，摆盘好看。');
  const warm = scorePraise('这道菜的火候不错，切得也整齐，摆盘好看，谢谢你，我很喜欢。');
  assert.ok(warm.breakdown.emotion > cold.breakdown.emotion);
});

test('满意线和最低字数可配置', () => {
  const strictLine = scorePraise(STRONG, { passScore: 99 });
  assert.equal(strictLine.passed, false);
  assert.equal(strictLine.hardFail.length, 0);

  const strictLength = scorePraise(STRONG, { minLen: 50 });
  assert.equal(strictLength.passed, false);
  assert.ok(strictLength.hardFail.indexOf('too_short') >= 0);
});

test('篇幅、具体、走心、新意、表达五项上限合计 100', () => {
  const total = BREAKDOWN_META.reduce((sum, item) => sum + item.max, 0);
  assert.equal(total, 100);
  const result = scorePraise(STRONG);
  BREAKDOWN_META.forEach(item => {
    assert.ok(result.breakdown[item.key] >= 0);
    assert.ok(result.breakdown[item.key] <= item.max);
  });
});

test('工具函数：有效字数、归一化、相似度、等级', () => {
  assert.equal(effectiveLength('你 好，👍！'), 2);
  assert.equal(effectiveLength('👨‍🍳'), 0);
  assert.equal(normalizeForMatch('你好，世界！'), '你好世界');
  assert.equal(similarity('今天真开心', '今天真开心'), 1);
  assert.ok(similarity('今天真开心', '明天要下雨') < 0.5);

  assert.equal(gradeFor(96, true).label, '惊为天人');
  assert.equal(gradeFor(90, true).label, '龙颜大悦');
  assert.equal(gradeFor(80, true).label, '准了');
  assert.equal(gradeFor(70, false).label, '差一点');
  assert.equal(gradeFor(50, false).label, '不够走心');
  assert.equal(gradeFor(49, false).label, '重夸');
});
