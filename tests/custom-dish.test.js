'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const customDish = require('../shared/custom-dish');

test('自点菜识别：按 custom 标记或 custom_ 前缀', () => {
  assert.equal(customDish.isCustomId('custom_1'), true);
  assert.equal(customDish.isCustomId('dish_1'), false);
  assert.equal(customDish.isCustomItem({ custom: true, dishId: 'dish_1' }), true);
  assert.equal(customDish.isCustomItem({ dishId: 'custom_2' }), true);
  assert.equal(customDish.isCustomItem({ custom: false, dishId: 'dish_1' }), false);
  assert.equal(customDish.hasCustomItems([{ dishId: 'dish_1' }, { dishId: 'custom_1' }]), true);
  assert.equal(customDish.hasCustomItems([{ dishId: 'dish_1' }]), false);
});

test('自点菜门槛：默认加 8 分、10 字，正常单原样返回', () => {
  assert.deepEqual(customDish.thresholdsFor({ passScore: 80, minLen: 20 }, false), {
    passScore: 80,
    minLen: 20,
    raised: false
  });
  assert.deepEqual(customDish.thresholdsFor({ passScore: 80, minLen: 20 }, true), {
    passScore: 88,
    minLen: 30,
    raised: true
  });
  assert.deepEqual(customDish.thresholdsFor({ passScore: 95, minLen: 45 }, true), {
    passScore: 100,
    minLen: 55,
    raised: true
  });
  assert.deepEqual(customDish.thresholdsFor({ passScore: 100, minLen: 50 }, true), {
    passScore: 100,
    minLen: 60,
    raised: true
  });
});
