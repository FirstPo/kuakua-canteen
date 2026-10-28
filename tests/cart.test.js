'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? JSON.parse(storage.get(key)) : '';
  },
  setStorageSync(key, value) {
    storage.set(key, JSON.stringify(value));
  },
  removeStorageSync(key) {
    storage.delete(key);
  }
};

const cart = require('../miniprogram/utils/cart');

test('购物车：旧版扁平数据自动迁移', () => {
  storage.clear();
  storage.set('kuakua_cart_v1', JSON.stringify({ dish_a: 2, dish_b: 1 }));
  assert.deepEqual(cart.load(), { dish_a: 2, dish_b: 1 });
  assert.equal(storage.has('kuakua_cart_v1'), false);
  assert.ok(storage.has('kuakua_cart_v2'));
});

test('购物车：自点菜保留名称、价格和描述', () => {
  storage.clear();
  const id = cart.addCustom({
    name: '红烧排骨',
    desc: '多放土豆',
    emoji: '🥩',
    priceCents: 2500
  });
  assert.match(id, /^custom_/);
  assert.deepEqual(cart.load(), { [id]: 1 });
  assert.equal(cart.loadCustom()[id].name, '红烧排骨');
  assert.equal(cart.loadCustom()[id].priceCents, 2500);

  cart.setQty(id, 3);
  assert.equal(cart.load()[id], 3);
  assert.equal(cart.loadCustom()[id].desc, '多放土豆');

  cart.setQty('dish_a', 2);
  const map = cart.load();
  map[id] = 1;
  cart.save(map);
  assert.equal(cart.loadCustom()[id].priceCents, 2500);
  assert.equal(cart.load()['dish_a'], 2);

  assert.equal(cart.totalCents(cart.load(), [{ _id: 'dish_a', priceCents: 1200 }]), 1200 * 2 + 2500);

  cart.remove(id);
  assert.equal(cart.load()[id], undefined);
  assert.equal(cart.loadCustom()[id], undefined);
});

test('购物车：无效自点菜不落库，清空会连自点菜一起清', () => {
  storage.clear();
  assert.equal(cart.addCustom({ name: '', priceCents: 100 }), '');
  assert.equal(cart.addCustom({ name: '排骨', priceCents: 0 }), '');
  assert.deepEqual(cart.load(), {});

  const id = cart.addCustom({ name: '排骨', priceCents: 2500 });
  cart.clear();
  assert.deepEqual(cart.load(), {});
  assert.deepEqual(cart.loadCustom(), {});
  assert.equal(cart.load()[id], undefined);
});
