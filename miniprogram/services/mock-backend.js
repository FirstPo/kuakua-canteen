'use strict';

const { createService, AppError, CODES } = require('../shared/service');
const { createMockRepo } = require('./mock-repo');

const CHEF_ID = 'mock-chef';
const DINER_ID = 'mock-diner';

const repo = createMockRepo();
const service = createService({ repo: repo });

function ctx(openid) {
  return { openid: openid || '' };
}

function roleId(role) {
  return role === 'chef' ? CHEF_ID : DINER_ID;
}

function otherRole(role) {
  return role === 'chef' ? 'diner' : 'chef';
}

function defaultName(role) {
  return role === 'chef' ? '大厨' : '对象';
}

function defaultEmoji(role) {
  return role === 'chef' ? '🍳' : '🐰';
}

async function bootstrap() {
  return service.dispatch('bootstrap', ctx(repo.getCurrentOpenid()), {});
}

async function ensurePartner(role) {
  const users = await repo.listUsers();
  const other = otherRole(role);
  const openid = roleId(other);
  if (users.some(user => user._id === openid)) return;
  if (users.some(user => user.role === other)) return;
  try {
    await service.dispatch('bindRole', ctx(openid), {
      role: other,
      nickname: defaultName(other),
      emoji: defaultEmoji(other),
      passScore: 80,
      minLen: 20
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== CODES.ROLE_TAKEN) throw error;
  }
}

async function bindRole(payload) {
  const role = payload && payload.role;
  if (role !== 'chef' && role !== 'diner') {
    throw new AppError(CODES.INVALID_INPUT, '身份不对');
  }
  const openid = roleId(role);
  repo.setCurrentOpenid(openid);
  await service.dispatch('bindRole', ctx(openid), payload);
  await ensurePartner(role);
  return bootstrap();
}

async function switchRole(role) {
  if (role !== 'chef' && role !== 'diner') {
    throw new AppError(CODES.INVALID_INPUT, '身份不对');
  }
  const openid = roleId(role);
  const user = await repo.getUser(openid);
  if (!user) {
    throw new AppError(CODES.NOT_BOUND, '这个身份还没有绑定');
  }
  repo.setCurrentOpenid(openid);
  return bootstrap();
}

async function resetDemo() {
  repo.reset();
  return service.dispatch('bootstrap', ctx(''), {});
}

async function seedDemo() {
  const chef = await repo.getUser(CHEF_ID);
  const diner = await repo.getUser(DINER_ID);
  if (!chef || !diner) {
    throw new AppError(CODES.NOT_BOUND, '先在开张页把两个身份都建好');
  }
  const active = await repo.findActiveOrder(null);
  if (active) {
    throw new AppError(CODES.ACTIVE_ORDER, '先处理进行中的订单，再灌演示数据');
  }
  const existing = await repo.findOrderByClientToken(DINER_ID, 'demo-low');
  if (existing) {
    throw new AppError(CODES.INVALID_INPUT, '演示订单已经在了');
  }

  const menu = await service.dispatch('getMenu', ctx(DINER_ID), {});
  if (!menu.dishes.length) {
    throw new AppError(CODES.INVALID_INPUT, '菜单是空的，先加两道菜');
  }
  const first = menu.dishes.find(dish => dish.name === '油泼面') || menu.dishes[0];
  const second = menu.dishes.find(dish => dish.name === '冰粉') || menu.dishes[menu.dishes.length - 1];
  const items = [{ dishId: first._id, qty: 1 }];
  if (second._id !== first._id) items.push({ dishId: second._id, qty: 1 });

  const low = await service.dispatch('createOrder', ctx(DINER_ID), {
    items: items,
    praise: '你做的饭真好吃',
    note: '',
    clientToken: 'demo-low'
  });
  await service.dispatch('cancelOrder', ctx(DINER_ID), {
    orderId: low.order._id,
    reason: '演示用的翻车现场'
  });

  let high = await service.dispatch('createOrder', ctx(DINER_ID), {
    items: items,
    praise: '你颠勺的样子真帅，' + first.name + '的香味飘满厨房，谢谢你每天给我做饭，以后我还想一直吃。',
    note: '少放辣',
    clientToken: 'demo-high'
  });
  if (high.order.status === 'rejected') {
    high = await service.dispatch('resubmitPraise', ctx(DINER_ID), {
      orderId: high.order._id,
      praise: '你切菜的时候特别认真，火候也拿得准，' + first.name + '端上来的时候香味飘满厨房，谢谢你一直记得我爱吃什么，这顿饭让我觉得特别幸福。',
      clientToken: 'demo-high-2'
    });
  }
  if (high.order.status === 'rejected') {
    high = await service.dispatch('chefApprove', ctx(CHEF_ID), {
      orderId: high.order._id,
      reason: '演示数据，破格准了'
    });
  }

  await service.dispatch('claimPayment', ctx(DINER_ID), {
    orderId: high.order._id,
    note: '演示转账'
  });
  await service.dispatch('confirmPayment', ctx(CHEF_ID), {
    orderId: high.order._id
  });
  await service.dispatch('startCooking', ctx(CHEF_ID), {
    orderId: high.order._id
  });
  await service.dispatch('finishCooking', ctx(CHEF_ID), {
    orderId: high.order._id
  });

  return bootstrap();
}

async function call(action, payload) {
  const data = payload || {};
  if (action === 'bindRole') return bindRole(data);
  if (action === 'switchRole') return switchRole(data.role);
  if (action === 'resetDemo') return resetDemo();
  if (action === 'seedDemo') return seedDemo();
  return service.dispatch(action, ctx(repo.getCurrentOpenid()), data);
}

module.exports = {
  call: call,
  isMock: true
};
