'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRepo, STORAGE_KEY } = require('../miniprogram/services/mock-repo');

function useStorage() {
  const data = new Map();
  global.wx = {
    getStorageSync(key) {
      return data.has(key) ? JSON.parse(data.get(key)) : '';
    },
    setStorageSync(key, value) {
      data.set(key, JSON.stringify(value));
    },
    removeStorageSync(key) {
      data.delete(key);
    }
  };
  return data;
}

function makeOrder(overrides) {
  return Object.assign({
    _id: 'o1',
    orderNo: 'K20260101-0001',
    dinerOpenid: 'u1',
    status: 'rejected',
    clientToken: 't1',
    totalCents: 1000,
    createdAt: 1000,
    updatedAt: 1000
  }, overrides || {});
}

test('空存储：没有设置和用户，角色槽位只能抢一次', async () => {
  useStorage();
  const repo = createMockRepo();
  assert.equal(await repo.getSettings(), null);
  assert.deepEqual(await repo.listUsers(), []);
  assert.deepEqual(await repo.listDishes(), []);
  assert.equal(repo.getCurrentOpenid(), '');

  assert.equal(await repo.claimRoleSlot('chef', 'a'), true);
  assert.equal(await repo.claimRoleSlot('chef', 'a'), true);
  assert.equal(await repo.claimRoleSlot('chef', 'b'), false);
  await repo.releaseRoleSlot('chef', 'b');
  assert.equal(await repo.claimRoleSlot('chef', 'b'), false);
  await repo.releaseRoleSlot('chef', 'a');
  assert.equal(await repo.claimRoleSlot('chef', 'b'), true);
  assert.equal((await repo.getSettings()).chefOpenid, 'b');
});

test('设置、用户、菜品、订单写入后能从本地存储重新加载', async () => {
  const storage = useStorage();
  const repo = createMockRepo();

  const settings = await repo.saveSettings({
    passScore: 85,
    minLen: 25,
    kitchenOpen: true,
    kitchenNote: '',
    seeded: false
  });
  assert.equal(settings._id, 'main');

  await repo.createUser({ _id: 'u1', role: 'diner', nickname: '小碗', emoji: '🐰' });
  await repo.createDish({
    _id: 'd1',
    name: '油泼面',
    priceCents: 1200,
    category: '招牌',
    available: true
  });
  await repo.createOrder(makeOrder({ status: 'approved', clientToken: 'persist-token' }));
  repo.setCurrentOpenid('u1');

  assert.ok(storage.has(STORAGE_KEY));

  const reloaded = createMockRepo();
  assert.equal((await reloaded.getSettings()).passScore, 85);
  assert.equal((await reloaded.getUser('u1')).nickname, '小碗');
  assert.equal((await reloaded.getDish('d1')).priceCents, 1200);
  assert.equal((await reloaded.getOrder('o1')).status, 'approved');
  assert.equal(reloaded.getCurrentOpenid(), 'u1');
});

test('重复创建用户、菜品、订单会报错，条件更新只在状态匹配时生效', async () => {
  useStorage();
  const repo = createMockRepo();
  await repo.createUser({ _id: 'u1', role: 'diner' });
  await assert.rejects(() => repo.createUser({ _id: 'u1', role: 'diner' }), /USER_EXISTS/);

  await repo.createDish({ _id: 'd1', name: '面' });
  await assert.rejects(() => repo.createDish({ _id: 'd1', name: '面' }), /DISH_EXISTS/);
  const autoDish = await repo.createDish({ name: '汤' });
  assert.equal(autoDish._id, 'dish_0001');
  await assert.rejects(() => repo.createDish({ _id: 'dish_0001', name: '汤' }), /DISH_EXISTS/);

  await repo.createOrder(makeOrder());
  await assert.rejects(() => repo.createOrder(makeOrder()), /ORDER_EXISTS/);

  assert.equal(await repo.updateOrder('o1', 'approved', { status: 'approved' }), false);
  assert.equal((await repo.getOrder('o1')).status, 'rejected');

  assert.equal(await repo.updateOrder('o1', 'rejected', { status: 'approved', approvedAt: 2000 }), true);
  const order = await repo.getOrder('o1');
  assert.equal(order.status, 'approved');
  assert.equal(order.approvedAt, 2000);
  assert.equal(await repo.updateOrder('missing', 'rejected', {}), false);
});

test('进行中订单、客户端令牌和按食客查询都按预期过滤排序', async () => {
  useStorage();
  const repo = createMockRepo();
  await repo.createOrder(makeOrder({ _id: 'old', status: 'rejected', createdAt: 1000 }));
  await repo.createOrder(makeOrder({
    _id: 'cooking',
    status: 'cooking',
    createdAt: 3000,
    clientToken: 'cook'
  }));
  await repo.createOrder(makeOrder({
    _id: 'served',
    status: 'served',
    createdAt: 4000,
    clientToken: 'served'
  }));
  await repo.createOrder(makeOrder({
    _id: 'other',
    status: 'rejected',
    dinerOpenid: 'u2',
    createdAt: 5000,
    clientToken: 'other'
  }));

  const active = await repo.findActiveOrder('u1');
  assert.equal(active._id, 'cooking');
  assert.equal(await repo.findActiveOrder('u3'), null);

  const token = await repo.findOrderByClientToken('u1', 'cook');
  assert.equal(token._id, 'cooking');
  assert.equal(await repo.findOrderByClientToken('u1', 'missing'), null);
  assert.equal(await repo.findOrderByClientToken('u1', ''), null);

  const mine = await repo.listOrdersByDiner('u1', 10);
  assert.deepEqual(mine.map(order => order._id), ['served', 'cooking', 'old']);

  const recent = await repo.getRecentOrdersByDiner('u1', 2);
  assert.deepEqual(recent.map(order => order._id), ['served', 'cooking']);

  const all = await repo.listAllOrders(10);
  assert.deepEqual(all.map(order => order._id), ['other', 'served', 'cooking', 'old']);

  const byIds = await repo.getDishesByIds([]);
  assert.deepEqual(byIds, []);
});

test('菜品更新删除、用户更新和重置', async () => {
  useStorage();
  const repo = createMockRepo();
  await repo.createUser({ _id: 'u1', role: 'chef', nickname: '大厨' });
  const updatedUser = await repo.updateUser('u1', { nickname: '新大厨' });
  assert.equal(updatedUser.nickname, '新大厨');

  await repo.createDish({ _id: 'd1', name: '面', available: true });
  await repo.createDish({ _id: 'd2', name: '汤', available: true });
  const updatedDish = await repo.updateDish('d1', { available: false });
  assert.equal(updatedDish.available, false);

  const found = await repo.getDishesByIds(['d1', 'd2', 'missing']);
  assert.deepEqual(found.map(dish => dish._id).sort(), ['d1', 'd2']);

  assert.equal(await repo.deleteDish('d1'), true);
  assert.equal(await repo.deleteDish('d1'), false);
  assert.equal(await repo.getDish('d1'), null);

  await repo.createOrder(makeOrder());
  repo.setCurrentOpenid('u1');
  repo.reset();

  assert.equal(repo.getCurrentOpenid(), '');
  assert.equal(await repo.getSettings(), null);
  assert.deepEqual(await repo.listUsers(), []);
  assert.deepEqual(await repo.listDishes(), []);
  assert.deepEqual(await repo.listAllOrders(), []);

  const reloaded = createMockRepo();
  assert.deepEqual(await reloaded.listUsers(), []);
  assert.deepEqual(await reloaded.listAllOrders(), []);
});
