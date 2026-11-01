'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createService, CODES } = require('../shared/service');
const { createMemoryRepo } = require('./helpers/memory-repo');
const catalog = require('../shared/catalog');
const { STATUS, timelineFor } = require('../shared/order-status');

const CHEF = 'openid_chef';
const DINER = 'openid_diner';

function fakeResult(score, passed, extra) {
  return Object.assign({
    engineVersion: 'test-1',
    score: score,
    passed: passed,
    hardFail: [],
    suggestions: [],
    breakdown: { length: 1, specificity: 1, emotion: 1, novelty: 1, expression: 1 },
    length: 20,
    rawLength: 20,
    minLen: 20,
    passScore: 80,
    similarity: 0,
    stats: {}
  }, extra || {});
}

function createHarness(options) {
  const opts = options || {};
  const repo = createMemoryRepo();
  let clock = Date.UTC(2026, 0, 1, 4, 0, 0);
  let randomState = 0.1;
  const scoreQueue = (opts.scores || []).slice();
  const scoreCalls = [];

  const fakeScorer = function (text, scoreOpts) {
    scoreCalls.push({ text: text, opts: scoreOpts });
    const next = scoreQueue.length ? scoreQueue.shift() : { score: 90, passed: true };
    const result = fakeResult(next.score, next.passed, next.extra);
    result.passScore = scoreOpts.passScore;
    result.minLen = scoreOpts.minLen;
    return result;
  };

  const service = createService({
    repo: repo,
    now: () => {
      clock += 1000;
      return clock;
    },
    random: () => {
      randomState = (randomState + 0.137) % 1;
      return randomState;
    },
    score: opts.realScore ? undefined : (opts.score || fakeScorer)
  });

  const chefCtx = { openid: CHEF };
  const dinerCtx = { openid: DINER };

  async function bindBoth() {
    await service.dispatch('bindRole', chefCtx, {
      role: 'chef',
      nickname: '大厨',
      emoji: '🍳',
      passScore: 80,
      minLen: 20
    });
    await service.dispatch('bindRole', dinerCtx, {
      role: 'diner',
      nickname: '小馋猫',
      emoji: '🐰'
    });
  }

  async function orderPayload(overrides) {
    const menu = await service.dispatch('getMenu', dinerCtx);
    const noodle = menu.dishes.find(dish => dish.name === '油泼面');
    const ice = menu.dishes.find(dish => dish.name === '冰粉');
    return Object.assign({
      items: [
        { dishId: noodle._id, qty: 2 },
        { dishId: ice._id, qty: 1 }
      ],
      praise: '你做的油泼面真好吃，谢谢大厨。',
      clientToken: 'token-1'
    }, overrides || {});
  }

  return {
    repo: repo,
    service: service,
    chefCtx: chefCtx,
    dinerCtx: dinerCtx,
    bindBoth: bindBoth,
    orderPayload: orderPayload,
    scoreCalls: scoreCalls
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    return true;
  });
}

test('bootstrap：厨师只有一个位置，食客不限人数', async () => {
  const h = createHarness();
  const first = await h.service.dispatch('bootstrap', h.chefCtx, {});
  assert.equal(first.access, 'setup');
  assert.deepEqual(first.availableRoles, ['chef', 'diner']);
  assert.equal(first.settings.passScore, 80);
  assert.equal(first.settings.minLen, 20);
  assert.equal((await h.repo.listDishes()).length, catalog.SEED_DISHES.length);

  const chef = await h.service.dispatch('bindRole', h.chefCtx, {
    role: 'chef',
    nickname: ' 大厨 ',
    emoji: '🍳',
    passScore: 88,
    minLen: 24
  });
  assert.equal(chef.access, 'ready');
  assert.equal(chef.role, 'chef');
  assert.equal(chef.user.nickname, '大厨');
  assert.equal(chef.settings.passScore, 88);
  assert.equal(chef.settings.minLen, 24);

  const dinerSetup = await h.service.dispatch('bootstrap', h.dinerCtx, {});
  assert.equal(dinerSetup.access, 'setup');
  assert.deepEqual(dinerSetup.availableRoles, ['diner']);

  const diner = await h.service.dispatch('bindRole', h.dinerCtx, {
    role: 'diner',
    nickname: '小猫',
    emoji: '🐰'
  });
  assert.equal(diner.access, 'ready');
  assert.equal(diner.role, 'diner');
  assert.equal(diner.partner.role, 'chef');

  const thirdCtx = { openid: 'openid_third' };
  const third = await h.service.dispatch('bootstrap', thirdCtx, {});
  assert.equal(third.access, 'setup');
  assert.deepEqual(third.availableRoles, ['diner']);
  assert.equal(third.dinerCount, 1);

  const thirdBind = await h.service.dispatch('bindRole', thirdCtx, {
    role: 'diner',
    nickname: '朋友'
  });
  assert.equal(thirdBind.access, 'ready');
  assert.equal(thirdBind.role, 'diner');
  assert.equal(thirdBind.partner.role, 'chef');

  const fourth = await h.service.dispatch('bindRole', { openid: 'openid_fourth' }, {
    role: 'diner',
    nickname: '再来一位'
  });
  assert.equal(fourth.role, 'diner');
  assert.equal((await h.repo.listUsers()).length, 4);

  const chefBoot = await h.service.dispatch('bootstrap', h.chefCtx, {});
  assert.equal(chefBoot.dinerCount, 3);

  const again = await h.service.dispatch('bindRole', h.chefCtx, {
    role: 'chef',
    nickname: '新名字'
  });
  assert.equal(again.role, 'chef');
  assert.equal(again.user.nickname, '大厨');
});

test('同一个身份只能被抢一次', async () => {
  const h = createHarness();
  await h.service.dispatch('bindRole', h.chefCtx, { role: 'chef', nickname: '大厨' });
  await rejectsWith(
    h.service.dispatch('bindRole', { openid: 'openid_other' }, { role: 'chef', nickname: '假厨师' }),
    CODES.ROLE_TAKEN
  );
  assert.equal((await h.repo.listUsers()).length, 1);
  assert.equal(await h.repo.claimRoleSlot('chef', 'openid_other'), false);
});

test('多位食客可以各自开一单，厨师能看到全部进行中的单', async () => {
  const h = createHarness();
  await h.bindBoth();
  const friendCtx = { openid: 'openid_friend' };
  await h.service.dispatch('bindRole', friendCtx, { role: 'diner', nickname: '朋友' });

  const menu = await h.service.dispatch('getMenu', h.dinerCtx);
  const dish = menu.dishes[0];
  const first = await h.service.dispatch('createOrder', h.dinerCtx, {
    items: [{ dishId: dish._id, qty: 1 }],
    praise: '你炒的菜真香，火候刚刚好。',
    clientToken: 'multi-1'
  });
  const second = await h.service.dispatch('createOrder', friendCtx, {
    items: [{ dishId: dish._id, qty: 1 }],
    praise: '这一盘我惦记好久了，谢谢大厨。',
    clientToken: 'multi-2'
  });
  assert.notEqual(first.order._id, second.order._id);

  const chefBoot = await h.service.dispatch('bootstrap', h.chefCtx, {});
  assert.equal(chefBoot.activeOrders.length, 2);
  assert.deepEqual(
    chefBoot.activeOrders.map(order => order._id).sort(),
    [first.order._id, second.order._id].sort()
  );

  // 同一位食客同一时间还是只能有一单在进行中。
  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, {
      items: [{ dishId: dish._id, qty: 1 }],
      praise: '再来一单。',
      clientToken: 'multi-3'
    }),
    CODES.ACTIVE_ORDER
  );
});

test('菜单：厨师增改删，食客无权，价格和分类要合法', async () => {
  const h = createHarness();
  await h.bindBoth();

  await rejectsWith(
    h.service.dispatch('saveDish', h.dinerCtx, {
      name: '偷加菜',
      priceCents: 100,
      category: '家常'
    }),
    CODES.FORBIDDEN
  );

  const created = await h.service.dispatch('saveDish', h.chefCtx, {
    name: '臊子面',
    desc: '酸辣香',
    emoji: '🍜',
    priceCents: 1300,
    category: '主食'
  });
  assert.equal(created.dish.name, '臊子面');
  assert.equal(created.dish.priceCents, 1300);
  const id = created.dish._id;

  const updated = await h.service.dispatch('saveDish', h.chefCtx, {
    id: id,
    name: '臊子面',
    desc: '酸辣香',
    emoji: '🍜',
    priceCents: 1500,
    category: '主食',
    available: false
  });
  assert.equal(updated.dish.priceCents, 1500);
  assert.equal(updated.dish.available, false);

  const menu = await h.service.dispatch('getMenu', h.dinerCtx);
  assert.equal(menu.dishes.find(dish => dish._id === id).priceCents, 1500);

  await rejectsWith(
    h.service.dispatch('saveDish', h.chefCtx, { name: '', priceCents: 100, category: '家常' }),
    CODES.INVALID_INPUT
  );
  await rejectsWith(
    h.service.dispatch('saveDish', h.chefCtx, { name: '贵菜', priceCents: 99901, category: '家常' }),
    CODES.INVALID_INPUT
  );
  await rejectsWith(
    h.service.dispatch('saveDish', h.chefCtx, { name: '怪菜', priceCents: 100, category: '外星' }),
    CODES.INVALID_INPUT
  );

  await h.service.dispatch('deleteDish', h.chefCtx, { id: id });
  const after = await h.service.dispatch('getMenu', h.dinerCtx);
  assert.equal(after.dishes.some(dish => dish._id === id), false);
});

test('完整生命周期：低分打回、重夸过线、付款、收款、开火、出锅', async () => {
  const h = createHarness({
    scores: [
      { score: 60, passed: false, extra: { hardFail: ['too_short'], suggestions: ['再多写点'] } },
      { score: 91, passed: true }
    ]
  });
  await h.bindBoth();

  const first = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload());
  assert.equal(first.order.status, STATUS.REJECTED);
  assert.equal(first.order.roundCount, 1);
  assert.equal(first.order.latestScore, 60);
  assert.equal(first.order.praiseRounds.length, 1);
  assert.equal(first.order.praiseRounds[0].hardFail[0], 'too_short');
  assert.equal(first.order.totalCents, 1200 * 2 + 700);
  assert.match(first.order.orderNo, /^K\d{8}-\d{4}$/);
  const orderId = first.order._id;

  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload({ clientToken: 'token-2' })),
    CODES.ACTIVE_ORDER
  );
  await rejectsWith(
    h.service.dispatch('resubmitPraise', h.chefCtx, { orderId: orderId, praise: '我来夸我自己' }),
    CODES.FORBIDDEN
  );

  const second = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: orderId,
    praise: '你颠勺的样子真帅，油泼面香得我连汤都想喝掉，谢谢大厨。',
    clientToken: 'round-2'
  });
  assert.equal(second.order.status, STATUS.APPROVED);
  assert.equal(second.order.roundCount, 2);
  assert.equal(second.order.latestScore, 91);
  assert.equal(second.order.praiseRounds[0].verdict, 'rejected');
  assert.equal(second.order.praiseRounds[1].verdict, 'approved');

  const claimed = await h.service.dispatch('claimPayment', h.dinerCtx, {
    orderId: orderId,
    note: '转啦'
  });
  assert.equal(claimed.order.status, STATUS.PAYMENT_CLAIMED);
  assert.ok(claimed.order.payment.claimedAt);
  assert.equal(claimed.order.payment.note, '转啦');

  const rejectedClaim = await h.service.dispatch('rejectPaymentClaim', h.chefCtx, {
    orderId: orderId,
    reason: '没看到'
  });
  assert.equal(rejectedClaim.order.status, STATUS.APPROVED);
  assert.ok(rejectedClaim.order.payment.rejectedAt);
  assert.equal(rejectedClaim.order.paymentClaimedAt, null);

  await h.service.dispatch('claimPayment', h.dinerCtx, { orderId: orderId });
  const paid = await h.service.dispatch('confirmPayment', h.chefCtx, { orderId: orderId });
  assert.equal(paid.order.status, STATUS.PAID);
  assert.ok(paid.order.payment.confirmedAt);

  const cooking = await h.service.dispatch('startCooking', h.chefCtx, { orderId: orderId });
  assert.equal(cooking.order.status, STATUS.COOKING);
  await rejectsWith(
    h.service.dispatch('startCooking', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );

  const served = await h.service.dispatch('finishCooking', h.chefCtx, { orderId: orderId });
  assert.equal(served.order.status, STATUS.SERVED);
  assert.ok(served.order.servedAt);

  const boot = await h.service.dispatch('bootstrap', h.dinerCtx, {});
  assert.equal(boot.activeOrder, null);

  const next = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload({
    clientToken: 'token-3'
  }));
  assert.equal(next.order.status, STATUS.APPROVED);

  const { stats } = await h.service.dispatch('getStats', h.chefCtx);
  assert.equal(stats.totalOrders, 2);
  assert.equal(stats.servedOrders, 1);
  assert.equal(stats.paidOrders, 1);
  assert.equal(stats.totalCents, 1200 * 2 + 700);
  assert.ok(stats.totalChars > 0);
  assert.equal(stats.maxScore, 91);
  assert.equal(stats.rejectedRounds, 1);
  assert.equal(stats.todayServed, 1);
});

test('厨师否决权：破格通过和打回已通过', async () => {
  const h = createHarness({
    scores: [
      { score: 62, passed: false },
      { score: 95, passed: true }
    ]
  });
  await h.bindBoth();
  const first = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload());
  const orderId = first.order._id;

  await rejectsWith(
    h.service.dispatch('chefApprove', h.dinerCtx, { orderId: orderId }),
    CODES.FORBIDDEN
  );
  const approved = await h.service.dispatch('chefApprove', h.chefCtx, {
    orderId: orderId,
    reason: '今天心情好'
  });
  assert.equal(approved.order.status, STATUS.APPROVED);
  assert.equal(approved.order.praiseRounds[0].reviewedBy, 'chef');
  assert.equal(approved.order.praiseRounds[0].verdict, 'approved');
  assert.equal(approved.order.praiseRounds[0].reason, '今天心情好');

  const rejected = await h.service.dispatch('chefReject', h.chefCtx, {
    orderId: orderId,
    reason: '太敷衍',
    demand: '夸夸我的刀工'
  });
  assert.equal(rejected.order.status, STATUS.REJECTED);
  assert.equal(rejected.order.praiseRounds[0].reviewedBy, 'chef');
  assert.equal(rejected.order.praiseRounds[0].demand, '夸夸我的刀工');

  const again = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: orderId,
    praise: '你的刀工像流水一样稳，切出来的青椒丝根根分明，我看呆了。'
  });
  assert.equal(again.order.status, STATUS.APPROVED);
  assert.equal(again.order.praiseRounds.length, 2);
  assert.equal(again.order.praiseRounds[1].score, 95);

  await rejectsWith(
    h.service.dispatch('claimPayment', h.chefCtx, { orderId: orderId }),
    CODES.FORBIDDEN
  );
  await rejectsWith(
    h.service.dispatch('confirmPayment', h.dinerCtx, { orderId: orderId }),
    CODES.FORBIDDEN
  );
});

test('付款只能按顺序走，越级和重复点击被拦住', async () => {
  const h = createHarness({ scores: [{ score: 88, passed: true }] });
  await h.bindBoth();
  const order = (await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload())).order;
  const orderId = order._id;

  await rejectsWith(
    h.service.dispatch('confirmPayment', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );
  await rejectsWith(
    h.service.dispatch('startCooking', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );
  await rejectsWith(
    h.service.dispatch('claimPayment', h.chefCtx, { orderId: orderId }),
    CODES.FORBIDDEN
  );

  await h.service.dispatch('claimPayment', h.dinerCtx, { orderId: orderId });
  await rejectsWith(
    h.service.dispatch('claimPayment', h.dinerCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );
  await rejectsWith(
    h.service.dispatch('cancelOrder', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );

  const paid = await h.service.dispatch('confirmPayment', h.chefCtx, { orderId: orderId });
  assert.equal(paid.order.status, STATUS.PAID);
  await rejectsWith(
    h.service.dispatch('rejectPaymentClaim', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );
  await rejectsWith(
    h.service.dispatch('finishCooking', h.chefCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );
});

test('clientToken 幂等：重复和并发都只落一单', async () => {
  const h = createHarness({ scores: [{ score: 90, passed: true }] });
  await h.bindBoth();
  const payload = await h.orderPayload({ clientToken: 'same-token' });

  const a = await h.service.dispatch('createOrder', h.dinerCtx, payload);
  const b = await h.service.dispatch('createOrder', h.dinerCtx, payload);
  assert.equal(a.order._id, b.order._id);
  assert.equal(b.deduped, true);
  assert.equal((await h.repo.listAllOrders(100)).length, 1);

  const h2 = createHarness({ scores: [{ score: 90, passed: true }] });
  await h2.bindBoth();
  const payload2 = await h2.orderPayload({ clientToken: 'race-token' });
  const results = await Promise.allSettled([
    h2.service.dispatch('createOrder', h2.dinerCtx, payload2),
    h2.service.dispatch('createOrder', h2.dinerCtx, payload2)
  ]);
  const fulfilled = results.filter(item => item.status === 'fulfilled');
  const ids = new Set(fulfilled.map(item => item.value.order._id));
  assert.ok(fulfilled.length >= 1);
  assert.equal(ids.size, 1);
  results.filter(item => item.status === 'rejected').forEach(item => {
    assert.ok(item.reason.code === CODES.ACTIVE_ORDER);
  });
  assert.equal((await h2.repo.listAllOrders(100)).length, 1);
});

test('重夸 clientToken 幂等，过线后重试不会再写一轮', async () => {
  const h = createHarness({
    scores: [
      { score: 55, passed: false },
      { score: 90, passed: true }
    ]
  });
  await h.bindBoth();
  const order = (await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload())).order;
  const first = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: order._id,
    praise: '这次真的走心了，你切菜的手像在跳舞。',
    clientToken: 'round-once'
  });
  assert.equal(first.order.praiseRounds.length, 2);
  const retry = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: order._id,
    praise: '这次真的走心了，你切菜的手像在跳舞。',
    clientToken: 'round-once'
  });
  assert.equal(retry.deduped, true);
  const stored = await h.repo.getOrder(order._id);
  assert.equal(stored.praiseRounds.length, 2);
});

test('归属：第二张食客身份看不到也动不了别人的订单', async () => {
  const h = createHarness({ scores: [{ score: 60, passed: false }] });
  await h.bindBoth();
  const order = (await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload())).order;

  h.repo._state.users.push({
    _id: 'openid_intruder',
    role: 'diner',
    nickname: '路人',
    emoji: '🕵️',
    createdAt: 1,
    updatedAt: 1
  });
  const intruder = { openid: 'openid_intruder' };

  await rejectsWith(
    h.service.dispatch('getOrder', intruder, { orderId: order._id }),
    CODES.FORBIDDEN
  );
  await rejectsWith(
    h.service.dispatch('claimPayment', intruder, { orderId: order._id }),
    CODES.FORBIDDEN
  );
  await rejectsWith(
    h.service.dispatch('resubmitPraise', intruder, { orderId: order._id, praise: '我来抢单' }),
    CODES.FORBIDDEN
  );
  await rejectsWith(
    h.service.dispatch('cancelOrder', intruder, { orderId: order._id }),
    CODES.FORBIDDEN
  );

  const chefView = await h.service.dispatch('getOrder', h.chefCtx, { orderId: order._id });
  assert.equal(chefView.order._id, order._id);
  const dinerView = await h.service.dispatch('getOrder', h.dinerCtx, { orderId: order._id });
  assert.deepEqual(dinerView.actions, ['repraise', 'cancel']);
});

test('取消与催促的状态边界', async () => {
  const h = createHarness({
    scores: [
      { score: 60, passed: false },
      { score: 90, passed: true }
    ]
  });
  await h.bindBoth();
  const first = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload());
  const orderId = first.order._id;

  await rejectsWith(
    h.service.dispatch('nudge', h.dinerCtx, { orderId: orderId }),
    CODES.INVALID_STATUS
  );

  const cancelled = await h.service.dispatch('cancelOrder', h.dinerCtx, {
    orderId: orderId,
    reason: '不饿了'
  });
  assert.equal(cancelled.order.status, STATUS.CANCELLED);
  assert.equal(cancelled.order.cancelledBy, 'diner');
  assert.equal(cancelled.order.cancelReason, '不饿了');

  const second = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload({
    clientToken: 'token-after-cancel'
  }));
  assert.equal(second.order.status, STATUS.APPROVED);
  await h.service.dispatch('claimPayment', h.dinerCtx, { orderId: second.order._id });

  const n1 = await h.service.dispatch('nudge', h.dinerCtx, { orderId: second.order._id });
  const n2 = await h.service.dispatch('nudge', h.dinerCtx, { orderId: second.order._id });
  assert.equal(n1.nudgeCount, 1);
  assert.equal(n2.nudgeCount, 2);

  await rejectsWith(
    h.service.dispatch('nudge', h.chefCtx, { orderId: second.order._id }),
    CODES.FORBIDDEN
  );
  await rejectsWith(
    h.service.dispatch('confirmPayment', h.dinerCtx, { orderId: second.order._id }),
    CODES.FORBIDDEN
  );
});

test('下单按现价快照，之后改价不影响旧单', async () => {
  const h = createHarness({ scores: [{ score: 90, passed: true }] });
  await h.bindBoth();
  const menu = await h.service.dispatch('getMenu', h.dinerCtx);
  const dish = menu.dishes.find(item => item.name === '可乐鸡翅');

  const order = (await h.service.dispatch('createOrder', h.dinerCtx, {
    items: [{ dishId: dish._id, qty: 3 }],
    praise: '你做的可乐鸡翅甜咸正好，收汁亮得能照镜子。',
    clientToken: 'price-snapshot'
  })).order;
  assert.equal(order.totalCents, 5400);
  assert.equal(order.items[0].priceCents, 1800);

  await h.service.dispatch('saveDish', h.chefCtx, {
    id: dish._id,
    name: dish.name,
    desc: dish.desc,
    emoji: dish.emoji,
    priceCents: 2500,
    category: dish.category
  });

  const reloaded = (await h.service.dispatch('getOrder', h.dinerCtx, { orderId: order._id })).order;
  assert.equal(reloaded.items[0].priceCents, 1800);
  assert.equal(reloaded.totalCents, 5400);
});

test('售罄和非法数量会被拒绝', async () => {
  const h = createHarness({ scores: [{ score: 90, passed: true }] });
  await h.bindBoth();
  const menu = await h.service.dispatch('getMenu', h.dinerCtx);
  const dish = menu.dishes[0];
  const base = { praise: '你做的菜真香，谢谢大厨。', clientToken: 'invalid-items' };

  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, {
      items: [{ dishId: dish._id, qty: 0 }]
    })),
    CODES.INVALID_ITEMS
  );
  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, {
      items: [{ dishId: dish._id, qty: 21 }]
    })),
    CODES.INVALID_ITEMS
  );
  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, { items: [] })),
    CODES.INVALID_ITEMS
  );

  await h.service.dispatch('saveDish', h.chefCtx, {
    id: dish._id,
    name: dish.name,
    desc: dish.desc,
    emoji: dish.emoji,
    priceCents: dish.priceCents,
    category: dish.category,
    available: false
  });
  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, {
      items: [{ dishId: dish._id, qty: 1 }]
    })),
    CODES.DISH_UNAVAILABLE
  );
});

test('自点菜：快照价格、加严满意线，正常单不受影响', async () => {
  const h = createHarness({
    scores: [
      { score: 82, passed: false },
      { score: 90, passed: true },
      { score: 90, passed: true }
    ]
  });
  await h.bindBoth();
  const menu = await h.service.dispatch('getMenu', h.dinerCtx);
  const noodle = menu.dishes.find(dish => dish.name === '油泼面');

  const created = await h.service.dispatch('createOrder', h.dinerCtx, {
    items: [
      { dishId: noodle._id, qty: 1 },
      { custom: true, name: ' 红烧排骨 ', desc: '多放土豆', emoji: '🥩', priceCents: 2500, qty: 2 }
    ],
    praise: '你做的油泼面真好吃，红烧排骨也拜托了。',
    clientToken: 'custom-1'
  });
  const order = created.order;
  assert.equal(order.status, STATUS.REJECTED);
  assert.equal(order.hasCustom, true);
  assert.equal(order.passScore, 88);
  assert.equal(order.minLen, 30);
  assert.equal(h.scoreCalls[0].opts.passScore, 88);
  assert.equal(h.scoreCalls[0].opts.minLen, 30);
  assert.equal(order.praiseRounds[0].passScore, 88);
  assert.equal(order.praiseRounds[0].minLen, 30);

  const custom = order.items.find(item => item.custom);
  assert.equal(custom.dishId, 'custom_1');
  assert.equal(custom.name, '红烧排骨');
  assert.equal(custom.desc, '多放土豆');
  assert.equal(custom.emoji, '🥩');
  assert.equal(custom.priceCents, 2500);
  assert.equal(custom.qty, 2);
  assert.equal(custom.lineTotalCents, 5000);
  assert.equal(order.totalCents, 5000 + 1200);

  const second = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: order._id,
    praise: '你颠勺的样子真帅，排骨炖得脱骨，谢谢你每天给我做饭。',
    clientToken: 'custom-2'
  });
  assert.equal(second.order.status, STATUS.APPROVED);
  assert.equal(second.order.hasCustom, true);
  assert.equal(second.order.passScore, 88);
  assert.equal(second.order.minLen, 30);
  assert.equal(h.scoreCalls[1].opts.passScore, 88);
  assert.equal(h.scoreCalls[1].opts.minLen, 30);
  assert.equal(second.order.praiseRounds[1].passScore, 88);

  await h.service.dispatch('cancelOrder', h.dinerCtx, { orderId: order._id });
  const normal = await h.service.dispatch('createOrder', h.dinerCtx, {
    items: [{ dishId: noodle._id, qty: 1 }],
    praise: '油泼面真香。',
    clientToken: 'normal-1'
  });
  assert.equal(normal.order.hasCustom, false);
  assert.equal(normal.order.passScore, 80);
  assert.equal(normal.order.minLen, 20);
  assert.equal(h.scoreCalls[2].opts.passScore, 80);
  assert.equal(h.scoreCalls[2].opts.minLen, 20);
});

test('自点菜：名字、价格、数量、描述都要合法，emoji 兜底', async () => {
  const h = createHarness();
  await h.bindBoth();
  const base = { praise: '你做的菜真香，谢谢大厨。' };

  const invalid = [
    { custom: true, name: '', priceCents: 100, qty: 1 },
    { custom: true, name: '红烧排骨', priceCents: 0, qty: 1 },
    { custom: true, name: '红烧排骨', priceCents: 50, qty: 1 },
    { custom: true, name: '红烧排骨', priceCents: 99901, qty: 1 },
    { custom: true, name: '红烧排骨', priceCents: 100, qty: 21 },
    { custom: true, name: '红烧排骨', desc: '很长'.repeat(21), priceCents: 100, qty: 1 },
    { custom: true, name: '油泼面', priceCents: 100, qty: 1 }
  ];
  for (let i = 0; i < invalid.length; i++) {
    await rejectsWith(
      h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, {
        items: [invalid[i]],
        clientToken: 'bad-custom-' + i
      })),
      CODES.INVALID_ITEMS
    );
  }

  const order = (await h.service.dispatch('createOrder', h.dinerCtx, Object.assign({}, base, {
    items: [{ custom: true, name: '随便炒个菜', emoji: '不是emoji', priceCents: 100, qty: 1 }],
    clientToken: 'custom-emoji-fallback'
  }))).order;
  assert.equal(order.hasCustom, true);
  assert.equal(order.items[0].emoji, '🍲');
});

test('自点菜门槛封顶：满意线最高 100，最低字数最高 60', async () => {
  const h = createHarness();
  await h.bindBoth();
  await h.service.dispatch('updatePraiseConfig', h.chefCtx, { passScore: 95, minLen: 45 });

  const order = (await h.service.dispatch('createOrder', h.dinerCtx, {
    items: [{ custom: true, name: '佛跳墙', priceCents: 99900, qty: 1 }],
    praise: '你做的佛跳墙真香。',
    clientToken: 'custom-cap'
  })).order;
  assert.equal(order.passScore, 100);
  assert.equal(order.minLen, 55);
  assert.equal(h.scoreCalls[0].opts.passScore, 100);
  assert.equal(h.scoreCalls[0].opts.minLen, 55);
  assert.equal(order.totalCents, 99900);
});

test('歇业只拦新单，进行中的单可以继续重夸', async () => {
  const h = createHarness({
    scores: [
      { score: 70, passed: false },
      { score: 90, passed: true }
    ]
  });
  await h.bindBoth();

  await rejectsWith(
    h.service.dispatch('updateKitchen', h.dinerCtx, { open: false }),
    CODES.FORBIDDEN
  );
  const closed = await h.service.dispatch('updateKitchen', h.chefCtx, {
    open: false,
    note: '今天累了'
  });
  assert.equal(closed.settings.kitchenOpen, false);
  assert.equal(closed.settings.kitchenNote, '今天累了');

  const payload = await h.orderPayload({ clientToken: 'closed-token' });
  await rejectsWith(
    h.service.dispatch('createOrder', h.dinerCtx, payload),
    CODES.KITCHEN_CLOSED
  );

  await h.service.dispatch('updateKitchen', h.chefCtx, { open: true });
  const order = await h.service.dispatch('createOrder', h.dinerCtx, payload);
  assert.equal(order.order.status, STATUS.REJECTED);

  await h.service.dispatch('updateKitchen', h.chefCtx, { open: false });
  const resubmitted = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: order.order._id,
    praise: '你切菜的声音像下雨，听着就饿了。'
  });
  assert.equal(resubmitted.order.status, STATUS.APPROVED);

  await rejectsWith(
    h.service.dispatch('updatePraiseConfig', h.dinerCtx, { passScore: 90, minLen: 20 }),
    CODES.FORBIDDEN
  );
  const settings = await h.service.dispatch('updatePraiseConfig', h.chefCtx, {
    passScore: 90,
    minLen: 25
  });
  assert.equal(settings.settings.passScore, 90);
  assert.equal(settings.settings.minLen, 25);
  await rejectsWith(
    h.service.dispatch('updatePraiseConfig', h.chefCtx, { passScore: 101, minLen: 20 }),
    CODES.INVALID_INPUT
  );
});

test('真实打分引擎接入：短句被打回，走心长句过线', async () => {
  const h = createHarness({ realScore: true });
  await h.bindBoth();

  const weak = await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload({
    praise: '你做的饭真好吃',
    clientToken: 'real-weak'
  }));
  assert.equal(weak.order.status, STATUS.REJECTED);
  assert.ok(weak.order.praiseRounds[0].hardFail.indexOf('too_short') >= 0);
  assert.equal(weak.order.latestScore, weak.order.praiseRounds[0].score);
  assert.ok(weak.order.praiseRounds[0].breakdown.length >= 0);

  const strong = await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: weak.order._id,
    praise: '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。'
  });
  assert.equal(strong.order.status, STATUS.APPROVED);
  assert.equal(strong.order.praiseRounds.length, 2);
  assert.ok(strong.order.praiseRounds[1].score >= 80);
  assert.equal(strong.order.praiseRounds[1].engineVersion, '1.0.0');
});

test('进行中订单在 bootstrap 和 getOrder 里带操作提示', async () => {
  const h = createHarness({ scores: [{ score: 60, passed: false }] });
  await h.bindBoth();
  const order = (await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload())).order;

  const dinerBoot = await h.service.dispatch('bootstrap', h.dinerCtx, {});
  assert.equal(dinerBoot.activeOrder._id, order._id);
  assert.equal(dinerBoot.activeOrder.latestScore, 60);
  assert.equal(dinerBoot.activeOrder.roundCount, 1);

  const chefBoot = await h.service.dispatch('bootstrap', h.chefCtx, {});
  assert.equal(chefBoot.activeOrder._id, order._id);

  const chefView = await h.service.dispatch('getOrder', h.chefCtx, { orderId: order._id });
  assert.deepEqual(chefView.actions, ['chefApprove', 'cancel']);
  assert.equal(chefView.settings.passScore, 80);
});

test('资料修改只作用到自己，夸夸墙归档高光和翻车', async () => {
  const h = createHarness({
    scores: [
      { score: 60, passed: false },
      { score: 92, passed: true }
    ]
  });
  await h.bindBoth();

  const updated = await h.service.dispatch('updateProfile', h.chefCtx, {
    nickname: '陕西大厨',
    emoji: '👨‍🍳'
  });
  assert.equal(updated.user.nickname, '陕西大厨');
  const dinerBoot = await h.service.dispatch('bootstrap', h.dinerCtx, {});
  assert.equal(dinerBoot.partner.nickname, '陕西大厨');

  await rejectsWith(
    h.service.dispatch('updateProfile', { openid: 'nobody' }, { nickname: 'x' }),
    CODES.NOT_BOUND
  );

  const order = (await h.service.dispatch('createOrder', h.dinerCtx, await h.orderPayload())).order;
  await h.service.dispatch('resubmitPraise', h.dinerCtx, {
    orderId: order._id,
    praise: '你切的青椒丝比我的头发还细，这手艺绝了。'
  });

  const wall = await h.service.dispatch('getPraiseWall', h.dinerCtx, {});
  assert.equal(wall.high.length, 1);
  assert.equal(wall.low.length, 1);
  assert.equal(wall.high[0].score, 92);
  assert.equal(wall.high[0].verdict, 'approved');
  assert.equal(wall.low[0].verdict, 'rejected');
  assert.ok(wall.high[0].breakdown);
  assert.ok(Array.isArray(wall.high[0].dishes));
});

test('init 可重复调用，未知 action 会报错', async () => {
  const h = createHarness();
  await h.service.dispatch('init', {}, {});
  await h.service.dispatch('init', {}, {});
  assert.equal((await h.repo.listDishes()).length, catalog.SEED_DISHES.length);
  await rejectsWith(h.service.dispatch('nope', {}, {}), CODES.UNKNOWN_ACTION);
});

test('并发 bootstrap 不会把示例菜灌两遍', async () => {
  const h = createHarness();
  await Promise.all([
    h.service.dispatch('bootstrap', h.chefCtx, {}),
    h.service.dispatch('bootstrap', h.dinerCtx, {})
  ]);
  const dishes = await h.repo.listDishes();
  assert.equal(dishes.length, catalog.SEED_DISHES.length);
  assert.equal(new Set(dishes.map(dish => dish._id)).size, dishes.length);
  assert.deepEqual(
    dishes.filter(dish => dish._id.indexOf('seed_') === 0).map(dish => dish.name).sort(),
    catalog.SEED_DISHES.map(dish => dish.name).sort()
  );
});

test('时间线：出餐后所有节点都算完成，进行中的单停在当前节点', () => {
  const served = timelineFor(STATUS.SERVED);
  assert.equal(served.length, 5);
  assert.ok(served.every(step => step.state === 'done'));

  const cooking = timelineFor(STATUS.COOKING);
  assert.equal(cooking.find(step => step.key === 'cooking').state, 'current');
  assert.equal(cooking.find(step => step.key === 'served').state, 'pending');
  assert.equal(cooking.find(step => step.key === 'approved').state, 'done');

  assert.deepEqual(timelineFor(STATUS.REJECTED), []);
  assert.deepEqual(timelineFor(STATUS.CANCELLED), []);
});
