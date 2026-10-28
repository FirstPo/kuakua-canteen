'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

function freshBackend() {
  delete require.cache[require.resolve('../miniprogram/services/mock-backend')];
  delete require.cache[require.resolve('../miniprogram/services/mock-repo')];
  return require('../miniprogram/services/mock-backend');
}

test('mock 后端：绑定、自动补对象、点菜夸奖、付款、开火、出锅、演示数据和重置', async () => {
  useStorage();
  const backend = freshBackend();

  const empty = await backend.call('bootstrap', {});
  assert.equal(empty.access, 'setup');

  const chef = await backend.call('bindRole', {
    role: 'chef',
    nickname: '大厨',
    emoji: '🍳',
    passScore: 80,
    minLen: 20
  });
  assert.equal(chef.access, 'ready');
  assert.equal(chef.role, 'chef');
  assert.ok(chef.partner);
  assert.equal(chef.partner.role, 'diner');
  assert.equal(chef.settings.passScore, 80);

  const menu = await backend.call('getMenu', {});
  assert.ok(menu.dishes.length >= 10);
  const dish = menu.dishes.find(item => item.name === '油泼面');
  assert.ok(dish);

  const diner = await backend.call('switchRole', { role: 'diner' });
  assert.equal(diner.role, 'diner');

  const created = await backend.call('createOrder', {
    items: [{ dishId: dish._id, qty: 1 }],
    praise: '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。',
    note: '少放辣',
    clientToken: 'backend-high'
  });
  assert.equal(created.order.status, 'approved');
  assert.equal(created.order.totalCents, 1200);

  const claimed = await backend.call('claimPayment', {
    orderId: created.order._id,
    note: '转账了'
  });
  assert.equal(claimed.order.status, 'payment_claimed');

  await backend.call('switchRole', { role: 'chef' });
  assert.equal((await backend.call('confirmPayment', {
    orderId: created.order._id
  })).order.status, 'paid');
  assert.equal((await backend.call('startCooking', {
    orderId: created.order._id
  })).order.status, 'cooking');
  assert.equal((await backend.call('finishCooking', {
    orderId: created.order._id
  })).order.status, 'served');

  await backend.call('switchRole', { role: 'diner' });
  const served = await backend.call('listOrders', { filter: 'served' });
  assert.equal(served.orders.length, 1);
  assert.equal(served.orders[0].status, 'served');

  const wall = await backend.call('getPraiseWall', {});
  assert.equal(wall.high.length, 1);
  assert.equal(wall.low.length, 0);

  const bootstrap = await backend.call('seedDemo', {});
  assert.equal(bootstrap.access, 'ready');
  const wallAfter = await backend.call('getPraiseWall', {});
  assert.ok(wallAfter.high.length >= 2);
  assert.ok(wallAfter.low.length >= 1);

  const beforeReset = await backend.call('listOrders', { filter: 'all' });
  assert.ok(beforeReset.orders.length >= 3);

  const reset = await backend.call('resetDemo', {});
  assert.equal(reset.access, 'setup');
  assert.equal(reset.user, null);
  const reopened = await backend.call('bootstrap', {});
  assert.deepEqual(reopened.availableRoles, ['chef', 'diner']);
  assert.equal(reopened.settings.seeded, true);
});
