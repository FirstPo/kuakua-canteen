'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const nav = [];
const storage = new Map();

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? JSON.parse(storage.get(key)) : '';
  },
  setStorageSync(key, value) {
    storage.set(key, JSON.stringify(value));
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  showToast() {},
  showLoading() {},
  hideLoading() {},
  showModal(options) {
    if (options && options.success) options.success({ confirm: true, cancel: false });
  },
  navigateTo(options) { nav.push({ type: 'navigateTo', url: options.url }); },
  redirectTo(options) { nav.push({ type: 'redirectTo', url: options.url }); },
  switchTab(options) { nav.push({ type: 'switchTab', url: options.url }); },
  reLaunch(options) { nav.push({ type: 'reLaunch', url: options.url }); },
  setNavigationBarTitle() {},
  stopPullDownRefresh() {},
  pageScrollTo() {},
  setClipboardData(options) {
    if (options && options.success) options.success();
  }
};

const backend = require('../miniprogram/services/mock-backend');

// 页面测试固定跑 mock，不读取项目当前的 cloud 配置。
const configPath = require.resolve('../miniprogram/config');
const realConfig = require(configPath);
require.cache[configPath].exports = Object.assign({}, realConfig, {
  MODE: 'mock',
  CLOUD_ENV_ID: ''
});

const app = {
  globalData: { role: null, settings: null, user: null },
  ensureBoot() {
    return backend.call('bootstrap', {});
  },
  refreshBoot() {
    return backend.call('bootstrap', {});
  },
  applyBoot(data) {
    this.globalData.role = data.role;
    this.globalData.settings = data.settings;
    this.globalData.user = data.user;
  }
};
global.getApp = () => app;

function setPath(target, key, value) {
  const parts = key.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function loadPage(rel) {
  delete require.cache[require.resolve(rel)];
  let config = null;
  global.Page = value => { config = value; };
  require(rel);
  if (!config) throw new Error('页面没有注册 Page：' + rel);
  const page = {};
  const data = clone(config.data || {});
  Object.keys(config).forEach(key => {
    if (typeof config[key] === 'function') page[key] = config[key].bind(page);
  });
  page.data = data;
  page.setData = (patch, callback) => {
    Object.keys(patch || {}).forEach(key => setPath(page.data, key, patch[key]));
    if (callback) callback();
  };
  page.getTabBar = () => ({ setData() {} });
  return page;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms == null ? 60 : ms));
}

function lastNav(type) {
  for (let i = nav.length - 1; i >= 0; i--) {
    if (!type || nav[i].type === type) return nav[i];
  }
  return null;
}

test('页面脚本：食客点菜、夸奖、开分、付款，厨师收款、开火、出锅', async () => {
  storage.clear();
  nav.length = 0;

  const chef = await backend.call('bindRole', {
    role: 'chef',
    nickname: '大厨',
    emoji: '🍳',
    passScore: 80,
    minLen: 20
  });
  assert.equal(chef.role, 'chef');
  await backend.call('switchRole', { role: 'diner' });

  const home = loadPage('../miniprogram/pages/home/home');
  home.onShow();
  await wait(100);
  assert.equal(home.data.role, 'diner');
  assert.ok(home.data.dishes.length >= 10);
  const dish = home.data.dishes.find(item => item.name === '油泼面');
  assert.ok(dish);

  home.onAdd({ currentTarget: { dataset: { id: dish._id } } });
  assert.equal(home.data.cartCount, 1);
  assert.equal(home.data.canCheckout, true);
  home.onCheckout();
  assert.equal(lastNav().url, '/pages/praise/praise');

  const praise = loadPage('../miniprogram/pages/praise/praise');
  praise.onLoad({});
  await wait(100);
  assert.equal(praise.data.items.length, 1);
  assert.equal(praise.data.totalText, '¥12');

  const praiseText = '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。';
  praise.onPraise({ detail: { value: praiseText } });
  assert.ok(praise.data.effLen >= 20);
  await praise.onSubmit();
  await wait(80);

  const verdictNav = lastNav('redirectTo');
  assert.ok(verdictNav);
  assert.ok(verdictNav.url.indexOf('/pages/verdict/verdict?orderId=') === 0);
  const orderId = verdictNav.url.split('orderId=')[1];

  const verdict = loadPage('../miniprogram/pages/verdict/verdict');
  verdict.onLoad({ orderId: orderId });
  await wait(100);
  assert.equal(verdict.data.loading, false);
  assert.equal(verdict.data.passed, true);
  assert.ok(verdict.data.round.score >= 80);
  assert.ok(verdict.data.grade);
  verdict.onUnload();

  const detail = loadPage('../miniprogram/pages/order-detail/order-detail');
  detail.onLoad({ orderId: orderId });
  await wait(100);
  assert.equal(detail.data.loading, false);
  assert.equal(detail.data.showPayment, true);
  assert.ok(detail.data.actions.some(action => action.key === 'claim'));

  detail.onAction({ currentTarget: { dataset: { key: 'claim' } } });
  assert.equal(detail.data.sheet.show, true);
  detail.onSheetSubmit();
  await wait(120);
  assert.equal((await backend.call('getOrder', { orderId: orderId })).order.status, 'payment_claimed');

  await backend.call('switchRole', { role: 'chef' });
  const chefDetail = loadPage('../miniprogram/pages/order-detail/order-detail');
  chefDetail.onLoad({ orderId: orderId });
  await wait(100);
  assert.ok(chefDetail.data.actions.some(action => action.key === 'confirmPayment'));

  await chefDetail.confirmAndRun('confirmPayment');
  await wait(80);
  assert.equal((await backend.call('getOrder', { orderId: orderId })).order.status, 'paid');

  await chefDetail.confirmAndRun('startCooking');
  await wait(80);
  assert.equal((await backend.call('getOrder', { orderId: orderId })).order.status, 'cooking');

  await chefDetail.confirmAndRun('finishCooking');
  await wait(80);
  assert.equal((await backend.call('getOrder', { orderId: orderId })).order.status, 'served');

  const orders = loadPage('../miniprogram/pages/orders/orders');
  orders.onShow();
  await wait(100);
  assert.equal(orders.data.role, 'chef');
  assert.equal(orders.data.filter, 'active');
  assert.equal(orders.data.orders.length, 0);
  orders.onFilter({ currentTarget: { dataset: { key: 'served' } } });
  await wait(100);
  assert.ok(orders.data.orders.length >= 1);

  const wall = loadPage('../miniprogram/pages/praise-wall/praise-wall');
  wall.onShow();
  await wait(100);
  assert.ok(wall.data.highCount >= 1);
  wall.onTab({ currentTarget: { dataset: { tab: 'low' } } });
  assert.equal(wall.data.activeTab, 'low');

  const me = loadPage('../miniprogram/pages/me/me');
  me.onShow();
  await wait(100);
  assert.equal(me.data.loading, false);
  assert.equal(me.data.isChef, true);
  assert.ok(me.data.user);
  assert.equal(me.data.passScore, 80);

  const kitchen = loadPage('../miniprogram/pages/kitchen/kitchen');
  kitchen.onShow();
  await wait(120);
  assert.equal(kitchen.data.loading, false);
  assert.ok(kitchen.data.stats);
  assert.ok(kitchen.data.dishCount >= 10);

  const menu = loadPage('../miniprogram/pages/menu-manage/menu-manage');
  menu.onShow();
  await wait(100);
  assert.equal(menu.data.loading, false);
  assert.ok(menu.data.dishes.length >= 10);

  const edit = loadPage('../miniprogram/pages/dish-edit/dish-edit');
  edit.onLoad({ id: dish._id });
  await wait(100);
  assert.equal(edit.data.loading, false);
  assert.equal(edit.data.name, '油泼面');
  assert.equal(edit.data.priceInput, '12');
});

test('页面脚本：开张、低分打回、重夸、厨师打回、再重夸、资料和标准', async () => {
  await backend.call('resetDemo', {});
  nav.length = 0;

  const setup = loadPage('../miniprogram/pages/setup/setup');
  setup.onLoad();
  await wait(100);
  assert.equal(setup.data.loading, false);
  assert.deepEqual(setup.data.availableRoles, ['chef', 'diner']);

  setup.onSelectRole({ currentTarget: { dataset: { role: 'chef' } } });
  assert.equal(setup.data.chefSelected, true);
  setup.onNickname({ detail: { value: '大厨' } });
  setup.onPassScore({ detail: { value: 80 } });
  setup.onMinLen({ detail: { value: 20 } });
  await setup.onSubmit();
  await wait(360);
  assert.equal(app.globalData.role, 'chef');
  assert.equal(lastNav('switchTab').url, '/pages/kitchen/kitchen');

  await backend.call('switchRole', { role: 'diner' });

  const home = loadPage('../miniprogram/pages/home/home');
  home.onShow();
  await wait(100);
  const dish = home.data.dishes.find(item => item.name === '油泼面');
  home.onAdd({ currentTarget: { dataset: { id: dish._id } } });
  home.onCheckout();

  const lowPraise = loadPage('../miniprogram/pages/praise/praise');
  lowPraise.onLoad({});
  await wait(100);
  lowPraise.onPraise({ detail: { value: '你做的饭真好吃' } });
  await lowPraise.onSubmit();
  await wait(100);
  const lowOrderId = lastNav('redirectTo').url.split('orderId=')[1];

  const lowVerdict = loadPage('../miniprogram/pages/verdict/verdict');
  lowVerdict.onLoad({ orderId: lowOrderId });
  await wait(100);
  assert.equal(lowVerdict.data.passed, false);
  assert.ok(lowVerdict.data.round.score < 80);
  assert.ok(lowVerdict.data.hardFailTexts.length > 0);
  lowVerdict.onUnload();

  const repraise = loadPage('../miniprogram/pages/praise/praise');
  repraise.onLoad({ orderId: lowOrderId });
  await wait(100);
  assert.ok(repraise.data.previous);
  assert.equal(repraise.data.previous.score < 80, true);
  const strongOne = '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。';
  repraise.onPraise({ detail: { value: strongOne } });
  await repraise.onSubmit();
  await wait(100);
  const approved = await backend.call('getOrder', { orderId: lowOrderId });
  assert.equal(approved.order.status, 'approved');

  await backend.call('switchRole', { role: 'chef' });
  const chefDetail = loadPage('../miniprogram/pages/order-detail/order-detail');
  chefDetail.onLoad({ orderId: lowOrderId });
  await wait(100);
  assert.ok(chefDetail.data.actions.some(action => action.key === 'chefReject'));
  chefDetail.onAction({ currentTarget: { dataset: { key: 'chefReject' } } });
  assert.equal(chefDetail.data.sheet.show, true);
  assert.equal(chefDetail.data.sheet.showDemand, true);
  chefDetail.onSheetInput({
    currentTarget: { dataset: { field: 'reason' } },
    detail: { value: '像网上抄的' }
  });
  chefDetail.onSheetInput({
    currentTarget: { dataset: { field: 'demand' } },
    detail: { value: '夸夸我切菜的样子' }
  });
  chefDetail.onSheetSubmit();
  await wait(120);
  const rejected = await backend.call('getOrder', { orderId: lowOrderId });
  assert.equal(rejected.order.status, 'rejected');
  const rejectedRounds = rejected.order.praiseRounds;
  assert.equal(rejectedRounds[rejectedRounds.length - 1].demand, '夸夸我切菜的样子');

  await backend.call('switchRole', { role: 'diner' });
  const vetoed = loadPage('../miniprogram/pages/praise/praise');
  vetoed.onLoad({ orderId: lowOrderId });
  await wait(100);
  assert.equal(vetoed.data.previous.demand, '夸夸我切菜的样子');
  const strongTwo = '你系着围裙在灶台前忙了一晚上，刀工利落，火候也稳，油泼面端上来的时候我口水都要流下来了；谢谢你把我爱吃的都记在心里，这样的日子我想一直过下去。';
  vetoed.onPraise({ detail: { value: strongTwo } });
  await vetoed.onSubmit();
  await wait(100);
  const reapproved = await backend.call('getOrder', { orderId: lowOrderId });
  assert.equal(reapproved.order.status, 'approved');

  await backend.call('switchRole', { role: 'chef' });
  const me = loadPage('../miniprogram/pages/me/me');
  me.onShow();
  await wait(100);
  me.onOpenProfile();
  me.onProfileInput({ detail: { value: '老张' } });
  me.onAvatar({ currentTarget: { dataset: { emoji: '🐻' } } });
  await me.onSaveProfile();
  await wait(80);
  assert.equal(me.data.user.nickname, '老张');
  assert.equal(me.data.user.emoji, '🐻');

  me.onPassChange({ detail: { value: 90 } });
  me.onMinLenChange({ detail: { value: 25 } });
  await me.onSaveConfig();
  assert.equal(me.data.settings.passScore, 90);
  assert.equal(me.data.settings.minLen, 25);
});

test('页面脚本：自主添加菜品、加严门槛、重夸过线', async () => {
  await backend.call('resetDemo', {});
  nav.length = 0;

  await backend.call('bindRole', {
    role: 'chef',
    nickname: '大厨',
    emoji: '🍳',
    passScore: 80,
    minLen: 20
  });
  await backend.call('switchRole', { role: 'diner' });

  const home = loadPage('../miniprogram/pages/home/home');
  home.onShow();
  await wait(100);
  assert.equal(home.data.hasCustom, false);
  assert.equal(home.data.customPassScore, 88);

  home.onOpenCustom();
  assert.equal(home.data.customForm.show, true);
  home.onCustomInput({
    currentTarget: { dataset: { field: 'name' } },
    detail: { value: '红烧排骨' }
  });
  home.onCustomInput({
    currentTarget: { dataset: { field: 'desc' } },
    detail: { value: '多放土豆' }
  });
  home.onCustomInput({
    currentTarget: { dataset: { field: 'priceInput' } },
    detail: { value: '25' }
  });
  home.onCustomEmoji({ currentTarget: { dataset: { emoji: '🥩' } } });
  home.onCustomSubmit();

  assert.equal(home.data.customForm.show, false);
  assert.equal(home.data.customItems.length, 1);
  assert.equal(home.data.customItems[0].name, '红烧排骨');
  assert.equal(home.data.customItems[0].priceText, '¥25');
  assert.equal(home.data.cartCount, 1);
  assert.equal(home.data.cartTotalText, '¥25');
  assert.equal(home.data.hasCustom, true);
  assert.equal(home.data.passScore, 88);
  assert.equal(home.data.minLen, 30);

  const dish = home.data.dishes.find(item => item.name === '油泼面');
  home.onAdd({ currentTarget: { dataset: { id: dish._id } } });
  assert.equal(home.data.cartCount, 2);
  assert.equal(home.data.cartTotalText, '¥37');
  home.onCheckout();

  const praise = loadPage('../miniprogram/pages/praise/praise');
  praise.onLoad({});
  await wait(100);
  assert.equal(praise.data.items.length, 2);
  assert.equal(praise.data.hasCustom, true);
  assert.equal(praise.data.passScore, 88);
  assert.equal(praise.data.minLen, 30);
  assert.equal(praise.data.totalText, '¥37');

  const almost = '你颠勺的样子真帅，油泼面的辣子香得我直咽口水，谢谢你每天给我做饭，以后我还想一直吃。';
  praise.onPraise({ detail: { value: almost } });
  await praise.onSubmit();
  await wait(100);
  const firstOrderId = lastNav('redirectTo').url.split('orderId=')[1];

  const verdict = loadPage('../miniprogram/pages/verdict/verdict');
  verdict.onLoad({ orderId: firstOrderId });
  await wait(100);
  assert.equal(verdict.data.passed, false);
  assert.equal(verdict.data.passScore, 88);
  assert.equal(verdict.data.minLen, 30);
  assert.equal(verdict.data.hasCustom, true);
  assert.equal(verdict.data.round.score, 82);
  verdict.onUnload();

  const repraise = loadPage('../miniprogram/pages/praise/praise');
  repraise.onLoad({ orderId: firstOrderId });
  await wait(100);
  assert.equal(repraise.data.hasCustom, true);
  assert.equal(repraise.data.passScore, 88);
  assert.equal(repraise.data.previous.score, 82);
  const strong = '你系着围裙在灶台前忙了一晚上，刀工利落，火候也稳，红烧排骨炖得脱骨，油泼面端上来的时候我口水都要流下来了；谢谢你把我爱吃的都记在心里，这样的日子我想一直过下去。';
  repraise.onPraise({ detail: { value: strong } });
  await repraise.onSubmit();
  await wait(120);

  const result = await backend.call('getOrder', { orderId: firstOrderId });
  assert.equal(result.order.status, 'approved');
  assert.equal(result.order.hasCustom, true);
  assert.equal(result.order.passScore, 88);
  assert.equal(result.order.minLen, 30);
  assert.equal(result.order.totalCents, 3700);
  const customItem = result.order.items.find(item => item.custom);
  assert.ok(customItem);
  assert.equal(customItem.name, '红烧排骨');
  assert.equal(customItem.desc, '多放土豆');
  assert.equal(customItem.emoji, '🥩');
  assert.equal(customItem.priceCents, 2500);
  assert.equal(customItem.qty, 1);
});
