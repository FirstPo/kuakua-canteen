'use strict';

const catalog = require('./catalog');
const customDish = require('./custom-dish');
const fmt = require('./format');
const orderStatus = require('./order-status');
const { scorePraise, effectiveLength, normalizeForMatch } = require('./praise-score');

const CODES = {
  NOT_BOUND: 'NOT_BOUND',
  CLOSED: 'CLOSED',
  ROLE_TAKEN: 'ROLE_TAKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_ITEMS: 'INVALID_ITEMS',
  DISH_UNAVAILABLE: 'DISH_UNAVAILABLE',
  KITCHEN_CLOSED: 'KITCHEN_CLOSED',
  ACTIVE_ORDER: 'ACTIVE_ORDER',
  INVALID_STATUS: 'INVALID_STATUS',
  CONFLICT: 'CONFLICT',
  PRAISE_EMPTY: 'PRAISE_EMPTY',
  PRAISE_TOO_LONG: 'PRAISE_TOO_LONG',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  DB_NOT_READY: 'DB_NOT_READY'
};

class AppError extends Error {
  constructor(code, message, details) {
    super(message || '出错了');
    this.name = 'AppError';
    this.code = code || 'ERROR';
    if (details) this.details = details;
  }
}

function fail(code, message, details) {
  throw new AppError(code, message, details);
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  const v = Math.round(n);
  if (v < min || v > max) return fallback;
  return v;
}

function textLen(value) {
  return Array.from(trim(value)).length;
}

// 仅用于同一个 clientToken 的幂等去重，不用于安全场景。
function orderIdForToken(openid, token) {
  const source = String(openid) + '|' + String(token);
  let hash = 5381;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
  }
  return 'o' + hash.toString(36);
}

function createService(options) {
  const opts = options || {};
  const repo = opts.repo;
  if (!repo) throw new Error('repo is required');
  const now = opts.now || (() => Date.now());
  const random = opts.random || Math.random;
  const scoreFn = opts.score || scorePraise;

  function clock() {
    return Number(now());
  }

  function defaults() {
    return {
      _id: 'main',
      chefOpenid: null,
      dinerOpenid: null,
      passScore: catalog.DEFAULT_PASS_SCORE,
      minLen: catalog.DEFAULT_MIN_LEN,
      kitchenOpen: true,
      kitchenNote: '',
      seeded: false,
      createdAt: clock(),
      updatedAt: clock()
    };
  }

  function normalizeSettings(settings) {
    const out = Object.assign(defaults(), settings || {});
    out.passScore = clampInt(out.passScore, 60, 100, catalog.DEFAULT_PASS_SCORE);
    out.minLen = clampInt(out.minLen, 10, 50, catalog.DEFAULT_MIN_LEN);
    out.kitchenOpen = out.kitchenOpen !== false;
    out.kitchenNote = trim(out.kitchenNote).slice(0, catalog.MAX_NOTE_LEN);
    out.seeded = !!out.seeded;
    return out;
  }

  function publicSettings(settings) {
    return {
      passScore: settings.passScore,
      minLen: settings.minLen,
      kitchenOpen: settings.kitchenOpen,
      kitchenNote: settings.kitchenNote,
      seeded: settings.seeded
    };
  }

  async function ensureSettings() {
    const current = await repo.getSettings();
    if (current) return normalizeSettings(current);
    const created = defaults();
    const saved = await repo.saveSettings(created);
    return normalizeSettings(saved || created);
  }

  async function ensureSeed() {
    const settings = await ensureSettings();
    if (settings.seeded) return settings;
    const dishes = await repo.listDishes();
    const existing = new Set(dishes.map(dish => dish._id));
    const t = clock();
    const missing = [];
    for (let i = 0; i < catalog.SEED_DISHES.length; i++) {
      const seed = catalog.SEED_DISHES[i];
      const doc = Object.assign({
        _id: 'seed_' + String(i + 1).padStart(2, '0')
      }, seed, {
        available: true,
        createdAt: t,
        updatedAt: t
      });
      if (!existing.has(doc._id)) missing.push(doc);
    }
    // 并发写入：首次初始化要控制在云函数 3 秒超时内。
    // 中途超时也没关系，seeded 标记没落库，下次只补缺的几道。
    await Promise.all(missing.map(doc => repo.createDish(doc).catch(error => {
      const message = String(error && (error.errMsg || error.message) || error || '');
      if (!/duplicate|exists|已存在|E11000|_id/i.test(message)) throw error;
    })));
    settings.seeded = true;
    settings.updatedAt = clock();
    await repo.saveSettings(settings);
    return settings;
  }

  async function ensureReadyData() {
    if (typeof repo.ensureCollections === 'function') {
      await repo.ensureCollections();
    }
    await ensureSeed();
  }

  async function getMembers() {
    const users = await repo.listUsers();
    const chef = typeof repo.getFirstUserByRole === 'function'
      ? await repo.getFirstUserByRole('chef')
      : (users.find(u => u.role === 'chef') || null);
    const diner = typeof repo.getFirstUserByRole === 'function'
      ? await repo.getFirstUserByRole('diner')
      : (users.find(u => u.role === 'diner') || null);
    const dinerCount = typeof repo.countUsersByRole === 'function'
      ? await repo.countUsersByRole('diner')
      : users.filter(u => u.role === 'diner').length;
    return {
      users: users,
      chef: chef,
      diner: diner,
      dinerCount: dinerCount
    };
  }

  async function requireBound(ctx) {
    if (!ctx || !ctx.openid) {
      fail(CODES.NOT_BOUND, '还没有选择身份');
    }
    const me = await repo.getUser(ctx.openid);
    if (!me) fail(CODES.NOT_BOUND, '还没有选择身份');
    return me;
  }

  async function requireChef(ctx) {
    const me = await requireBound(ctx);
    if (me.role !== 'chef') fail(CODES.FORBIDDEN, '只有厨师能做这件事');
    return me;
  }

  async function requireDiner(ctx) {
    const me = await requireBound(ctx);
    if (me.role !== 'diner') fail(CODES.FORBIDDEN, '只有食客能做这件事');
    return me;
  }

  async function loadOrder(id) {
    if (!id) fail(CODES.NOT_FOUND, '订单不存在');
    const order = await repo.getOrder(id);
    if (!order) fail(CODES.NOT_FOUND, '订单不存在');
    return order;
  }

  function summarize(order) {
    const rounds = order.praiseRounds || [];
    const latest = rounds.length ? rounds[rounds.length - 1] : null;
    return {
      _id: order._id,
      orderNo: order.orderNo,
      status: order.status,
      statusLabel: orderStatus.statusLabel(order.status),
      totalCents: order.totalCents,
      items: order.items || [],
      dishNames: (order.items || []).map(item => item.name),
      note: order.note || '',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      roundCount: order.roundCount || rounds.length,
      latestScore: order.latestScore != null ? order.latestScore : (latest ? latest.score : 0),
      latestRound: latest ? {
        round: latest.round,
        score: latest.score,
        verdict: latest.verdict,
        text: latest.text,
        suggestions: latest.suggestions || [],
        hardFail: latest.hardFail || []
      } : null,
      nudgeCount: order.nudgeCount || 0,
      payment: order.payment || null
    };
  }

  function sortDishes(dishes) {
    return dishes.slice().sort((a, b) => {
      const ai = catalog.CATEGORIES.indexOf(a.category);
      const bi = catalog.CATEGORIES.indexOf(b.category);
      const ac = ai < 0 ? 99 : ai;
      const bc = bi < 0 ? 99 : bi;
      if (ac !== bc) return ac - bc;
      const as = Number(a.sort) || 0;
      const bs = Number(b.sort) || 0;
      if (as !== bs) return as - bs;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  function normalizeItems(input) {
    if (!Array.isArray(input) || !input.length) {
      fail(CODES.INVALID_ITEMS, '至少点一道菜');
    }
    const map = new Map();
    const custom = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i] || {};
      if (item.custom) {
        const name = trim(item.name);
        if (!name || textLen(name) > catalog.MAX_DISH_NAME_LEN) {
          fail(CODES.INVALID_ITEMS, '自点菜的名字要 1–' + catalog.MAX_DISH_NAME_LEN + ' 个字');
        }
        const desc = trim(item.desc);
        if (textLen(desc) > catalog.MAX_DISH_DESC_LEN) {
          fail(CODES.INVALID_ITEMS, '自点菜的描述最多 ' + catalog.MAX_DISH_DESC_LEN + ' 个字');
        }
        const priceCents = clampInt(item.priceCents, catalog.MIN_CUSTOM_PRICE_CENTS, catalog.MAX_PRICE_CENTS, null);
        if (priceCents == null) {
          fail(CODES.INVALID_ITEMS, '自点菜要写 1–999 元的价格');
        }
        const qty = clampInt(item.qty, 1, catalog.MAX_QTY, null);
        if (qty == null) {
          fail(CODES.INVALID_ITEMS, '自点菜数量不对');
        }
        let emoji = trim(item.emoji);
        if (catalog.EMOJI_CHOICES.indexOf(emoji) < 0) emoji = '🍲';
        custom.push({
          name: name,
          desc: desc,
          emoji: emoji,
          priceCents: priceCents,
          qty: qty
        });
        continue;
      }
      const dishId = trim(item.dishId);
      const qty = clampInt(item.qty, 1, catalog.MAX_QTY, null);
      if (!dishId || qty == null) {
        fail(CODES.INVALID_ITEMS, '菜品或数量不对');
      }
      map.set(dishId, (map.get(dishId) || 0) + qty);
    }
    const normal = [];
    map.forEach((qty, dishId) => {
      if (qty > catalog.MAX_QTY) fail(CODES.INVALID_ITEMS, '单道菜最多 20 份');
      normal.push({ dishId: dishId, qty: qty });
    });
    if (normal.length + custom.length > catalog.MAX_ITEMS) {
      fail(CODES.INVALID_ITEMS, '一次最多点 20 道菜');
    }
    return { normal: normal, custom: custom };
  }

  function makeRound(roundNo, text, topic, result, createdAt, clientToken) {
    return {
      round: roundNo,
      text: text,
      topic: trim(topic).slice(0, 80),
      score: result.score,
      breakdown: result.breakdown,
      hardFail: result.hardFail,
      suggestions: result.suggestions,
      verdict: result.passed ? 'approved' : 'rejected',
      reviewedBy: 'score',
      reason: '',
      demand: '',
      passScore: result.passScore != null ? result.passScore : null,
      minLen: result.minLen != null ? result.minLen : null,
      engineVersion: result.engineVersion,
      clientToken: clientToken || '',
      createdAt: createdAt,
      reviewedAt: createdAt
    };
  }

  async function collectPreviousTexts(dinerOpenid, currentOrder) {
    const texts = [];
    const seen = new Set();
    function add(text) {
      const key = normalizeForMatch(text);
      if (!key || seen.has(key)) return;
      seen.add(key);
      texts.push(text);
    }
    if (currentOrder) {
      (currentOrder.praiseRounds || []).forEach(round => add(round.text));
    }
    const recent = await repo.getRecentOrdersByDiner(dinerOpenid, 10);
    recent.forEach(order => {
      if (currentOrder && order._id === currentOrder._id) return;
      (order.praiseRounds || []).forEach(round => add(round.text));
    });
    return texts;
  }

  async function bootstrap(ctx) {
    await ensureReadyData();
    const settings = await ensureSettings();
    const members = await getMembers();
    const me = ctx && ctx.openid ? await repo.getUser(ctx.openid) : null;
    const base = {
      access: 'setup',
      role: null,
      user: null,
      partner: null,
      chef: members.chef,
      diner: members.diner,
      dinerCount: members.dinerCount,
      settings: publicSettings(settings),
      activeOrder: null,
      activeOrders: []
    };
    if (!me) {
      // 厨师只有一个位置；食客不限，来多少都能坐下。
      base.availableRoles = [];
      if (!members.chef) base.availableRoles.push('chef');
      base.availableRoles.push('diner');
      return base;
    }
    const partner = me.role === 'chef' ? null : members.chef;
    let activeOrders = [];
    if (me.role === 'chef' && typeof repo.listActiveOrders === 'function') {
      activeOrders = await repo.listActiveOrders();
    }
    const active = me.role === 'chef'
      ? (activeOrders[0] || null)
      : await repo.findActiveOrder(me._id);
    return Object.assign(base, {
      access: 'ready',
      role: me.role,
      user: me,
      partner: partner,
      chef: members.chef,
      diner: members.diner,
      dinerCount: members.dinerCount,
      activeOrder: active ? summarize(active) : null,
      activeOrders: activeOrders.map(summarize)
    });
  }

  async function init() {
    await ensureReadyData();
    return { ok: true };
  }

  async function bindRole(ctx, payload) {
    const role = payload.role;
    if (role !== 'chef' && role !== 'diner') {
      fail(CODES.INVALID_INPUT, '身份不对');
    }
    const nickname = trim(payload.nickname).slice(0, catalog.MAX_NICKNAME_LEN);
    if (!nickname) fail(CODES.INVALID_INPUT, '起个称呼吧');
    const emoji = trim(payload.emoji) || (role === 'chef' ? '🍳' : '🍚');
    if (textLen(emoji) > 4) fail(CODES.INVALID_INPUT, '换个小一点的 emoji');
    if (!ctx || !ctx.openid) fail(CODES.NOT_BOUND, '拿不到你的微信身份');

    await ensureReadyData();
    const existing = await repo.getUser(ctx.openid);
    if (existing) return bootstrap(ctx);

    // 厨师只有一位；食客不设上限，谁进来都能点菜。
    if (role === 'chef') {
      const users = await repo.listUsers();
      const chefCount = typeof repo.countUsersByRole === 'function'
        ? await repo.countUsersByRole('chef')
        : users.filter(user => user.role === 'chef').length;
      if (chefCount > 0) fail(CODES.ROLE_TAKEN, '厨师已经有人当了');
      if (typeof repo.claimRoleSlot === 'function') {
        const claimed = await repo.claimRoleSlot('chef', ctx.openid);
        if (!claimed) fail(CODES.ROLE_TAKEN, '厨师已经有人当了');
      }
    }

    const t = clock();
    const user = {
      _id: ctx.openid,
      role: role,
      nickname: nickname,
      emoji: emoji,
      createdAt: t,
      updatedAt: t
    };
    try {
      await repo.createUser(user);
    } catch (error) {
      if (role === 'chef' && typeof repo.releaseRoleSlot === 'function') {
        await repo.releaseRoleSlot('chef', ctx.openid);
      }
      throw error;
    }

    const settings = await ensureSettings();
    if (role === 'chef') {
      settings.chefOpenid = ctx.openid;
      settings.passScore = clampInt(payload.passScore, 60, 100, catalog.DEFAULT_PASS_SCORE);
      settings.minLen = clampInt(payload.minLen, 10, 50, catalog.DEFAULT_MIN_LEN);
    } else {
      settings.dinerOpenid = ctx.openid;
    }
    settings.updatedAt = t;
    await repo.saveSettings(settings);
    return bootstrap(ctx);
  }

  async function updateProfile(ctx, payload) {
    const me = await requireBound(ctx);
    const nickname = trim(payload.nickname).slice(0, catalog.MAX_NICKNAME_LEN);
    if (!nickname) fail(CODES.INVALID_INPUT, '称呼不能为空');
    const emoji = trim(payload.emoji) || me.emoji;
    if (textLen(emoji) > 4) fail(CODES.INVALID_INPUT, '换个小一点的 emoji');
    const user = await repo.updateUser(me._id, {
      nickname: nickname,
      emoji: emoji,
      updatedAt: clock()
    });
    return { user: user };
  }

  async function updateKitchen(ctx, payload) {
    await requireChef(ctx);
    const settings = await ensureSettings();
    if (typeof payload.open === 'boolean') settings.kitchenOpen = payload.open;
    if (payload.note != null) {
      settings.kitchenNote = trim(payload.note).slice(0, catalog.MAX_NOTE_LEN);
    }
    settings.updatedAt = clock();
    await repo.saveSettings(settings);
    return { settings: publicSettings(settings) };
  }

  async function updatePraiseConfig(ctx, payload) {
    await requireChef(ctx);
    const passScore = clampInt(payload.passScore, 60, 100, null);
    const minLen = clampInt(payload.minLen, 10, 50, null);
    if (passScore == null) fail(CODES.INVALID_INPUT, '满意线要在 60–100 之间');
    if (minLen == null) fail(CODES.INVALID_INPUT, '最低字数要在 10–50 之间');
    const settings = await ensureSettings();
    settings.passScore = passScore;
    settings.minLen = minLen;
    settings.updatedAt = clock();
    await repo.saveSettings(settings);
    return { settings: publicSettings(settings) };
  }

  async function getMenu(ctx) {
    await requireBound(ctx);
    const dishes = await repo.listDishes();
    return { dishes: sortDishes(dishes) };
  }

  async function saveDish(ctx, payload) {
    await requireChef(ctx);
    const id = payload.id || payload._id || null;
    const name = trim(payload.name);
    if (!name) fail(CODES.INVALID_INPUT, '菜名不能为空');
    if (textLen(name) > catalog.MAX_DISH_NAME_LEN) fail(CODES.INVALID_INPUT, '菜名太长');
    const desc = trim(payload.desc).slice(0, catalog.MAX_DISH_DESC_LEN);
    const emoji = trim(payload.emoji) || '🍽️';
    if (textLen(emoji) > 4) fail(CODES.INVALID_INPUT, '换个小一点的 emoji');
    const priceCents = clampInt(payload.priceCents, 0, catalog.MAX_PRICE_CENTS, null);
    if (priceCents == null) fail(CODES.INVALID_INPUT, '价格不对');
    const category = trim(payload.category);
    if (catalog.CATEGORIES.indexOf(category) < 0) fail(CODES.INVALID_INPUT, '分类不对');
    const available = payload.available !== false;
    const t = clock();

    if (id) {
      const existing = await repo.getDish(id);
      if (!existing) fail(CODES.NOT_FOUND, '这道菜不存在');
      const dish = await repo.updateDish(id, {
        name: name,
        desc: desc,
        emoji: emoji,
        priceCents: priceCents,
        category: category,
        available: available,
        updatedAt: t
      });
      return { dish: dish };
    }

    const dishes = await repo.listDishes();
    let sort = 1;
    dishes.forEach(d => {
      const n = Number(d.sort) || 0;
      if (n >= sort) sort = n + 1;
    });
    const dish = await repo.createDish({
      name: name,
      desc: desc,
      emoji: emoji,
      priceCents: priceCents,
      category: category,
      available: available,
      sort: sort,
      createdAt: t,
      updatedAt: t
    });
    return { dish: dish };
  }

  async function deleteDish(ctx, payload) {
    await requireChef(ctx);
    const id = payload.id || payload._id;
    if (!id) fail(CODES.NOT_FOUND, '菜品不存在');
    const existing = await repo.getDish(id);
    if (!existing) fail(CODES.NOT_FOUND, '菜品不存在');
    await repo.deleteDish(id);
    return { id: id };
  }

  async function createOrder(ctx, payload) {
    const me = await requireDiner(ctx);
    const settings = await ensureSettings();
    const token = trim(payload.clientToken).slice(0, 80);
    if (token && typeof repo.findOrderByClientToken === 'function') {
      const existing = await repo.findOrderByClientToken(me._id, token);
      if (existing) return { order: existing, deduped: true };
    }
    if (!settings.kitchenOpen) fail(CODES.KITCHEN_CLOSED, '厨师今天歇业');
    const active = await repo.findActiveOrder(me._id);
    if (active) fail(CODES.ACTIVE_ORDER, '上一单还没结束，先把那一单处理完', { orderId: active._id });

    const normalized = normalizeItems(payload.items);
    if (normalized.custom.length) {
      const allDishes = await repo.listDishes();
      const menuNames = new Set(allDishes.map(dish => normalizeForMatch(dish.name)));
      normalized.custom.forEach(item => {
        if (menuNames.has(normalizeForMatch(item.name))) {
          fail(CODES.INVALID_ITEMS, '这道菜菜单上有，直接点；售罄就等下次');
        }
      });
    }
    const dishes = normalized.normal.length
      ? await repo.getDishesByIds(normalized.normal.map(item => item.dishId))
      : [];
    const byId = {};
    dishes.forEach(dish => { byId[dish._id] = dish; });
    const snapshot = [];
    const missing = [];
    normalized.normal.forEach(item => {
      const dish = byId[item.dishId];
      if (!dish || !dish.available) {
        missing.push(dish ? dish.name : item.dishId);
        return;
      }
      snapshot.push({
        dishId: dish._id,
        custom: false,
        name: dish.name,
        emoji: dish.emoji,
        priceCents: dish.priceCents,
        qty: item.qty,
        lineTotalCents: dish.priceCents * item.qty
      });
    });
    if (missing.length) {
      fail(CODES.DISH_UNAVAILABLE, '这些菜现在点不了：' + missing.join('、'));
    }
    normalized.custom.forEach((item, index) => {
      snapshot.push({
        dishId: catalog.CUSTOM_ITEM_PREFIX + (index + 1),
        custom: true,
        name: item.name,
        desc: item.desc,
        emoji: item.emoji,
        priceCents: item.priceCents,
        qty: item.qty,
        lineTotalCents: item.priceCents * item.qty
      });
    });
    const hasCustom = normalized.custom.length > 0;
    const thresholds = customDish.thresholdsFor(settings, hasCustom);
    const totalCents = snapshot.reduce((sum, item) => sum + item.lineTotalCents, 0);
    const text = trim(payload.praise);
    if (!text) fail(CODES.PRAISE_EMPTY, '还没夸呢');
    if (textLen(text) > catalog.MAX_PRAISE_LEN) fail(CODES.PRAISE_TOO_LONG, '夸奖太长了，收着点');

    const previousTexts = await collectPreviousTexts(me._id, null);
    const result = scoreFn(text, {
      minLen: thresholds.minLen,
      passScore: thresholds.passScore,
      previousTexts: previousTexts,
      dishNames: snapshot.map(item => item.name)
    });
    const t = clock();
    const round = makeRound(1, text, payload.topic, result, t, token ? token + ':1' : '');
    const order = {
      orderNo: fmt.makeOrderNo(t, random),
      clientToken: token,
      dinerOpenid: me._id,
      items: snapshot,
      totalCents: totalCents,
      hasCustom: hasCustom,
      passScore: thresholds.passScore,
      minLen: thresholds.minLen,
      note: trim(payload.note).slice(0, catalog.MAX_NOTE_LEN),
      status: result.passed ? orderStatus.STATUS.APPROVED : orderStatus.STATUS.REJECTED,
      praiseRounds: [round],
      roundCount: 1,
      latestScore: result.score,
      payment: {
        claimedAt: null,
        confirmedAt: null,
        note: '',
        rejectedAt: null,
        rejectReason: ''
      },
      nudgeCount: 0,
      createdAt: t,
      updatedAt: t,
      approvedAt: result.passed ? t : null,
      rejectedAt: result.passed ? null : t,
      paymentClaimedAt: null,
      paidAt: null,
      cookingAt: null,
      servedAt: null,
      cancelledAt: null,
      cancelReason: '',
      cancelledBy: ''
    };
    if (token) order._id = orderIdForToken(me._id, token);
    let created;
    try {
      created = await repo.createOrder(order);
    } catch (error) {
      if (token && typeof repo.findOrderByClientToken === 'function') {
        const existing = await repo.findOrderByClientToken(me._id, token);
        if (existing) return { order: existing, deduped: true };
      }
      throw error;
    }
    return { order: created };
  }

  async function resubmitPraise(ctx, payload) {
    const me = await requireDiner(ctx);
    const order = await loadOrder(payload.orderId);
    if (order.dinerOpenid !== me._id) fail(CODES.FORBIDDEN, '这不是你的订单');
    const token = trim(payload.clientToken).slice(0, 80);
    if (token) {
      const existingRound = (order.praiseRounds || []).find(round => round.clientToken === token);
      if (existingRound) return { order: order, deduped: true };
    }
    if (!orderStatus.canRepraise(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不用重夸');
    }
    const text = trim(payload.praise);
    if (!text) fail(CODES.PRAISE_EMPTY, '还没夸呢');
    if (textLen(text) > catalog.MAX_PRAISE_LEN) fail(CODES.PRAISE_TOO_LONG, '夸奖太长了，收着点');

    const settings = await ensureSettings();
    const hasCustom = order.hasCustom === true || customDish.hasCustomItems(order.items);
    const thresholds = customDish.thresholdsFor(settings, hasCustom);
    const previousTexts = await collectPreviousTexts(me._id, order);
    const result = scoreFn(text, {
      minLen: thresholds.minLen,
      passScore: thresholds.passScore,
      previousTexts: previousTexts,
      dishNames: (order.items || []).map(item => item.name)
    });
    const t = clock();
    const roundNo = (order.praiseRounds || []).length + 1;
    const round = makeRound(roundNo, text, payload.topic, result, t, token);
    const nextStatus = result.passed ? orderStatus.STATUS.APPROVED : orderStatus.STATUS.REJECTED;
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.REJECTED, {
      status: nextStatus,
      praiseRounds: (order.praiseRounds || []).concat([round]),
      roundCount: roundNo,
      latestScore: result.score,
      hasCustom: hasCustom,
      passScore: thresholds.passScore,
      minLen: thresholds.minLen,
      updatedAt: t,
      rejectedAt: nextStatus === orderStatus.STATUS.REJECTED ? t : order.rejectedAt,
      approvedAt: nextStatus === orderStatus.STATUS.APPROVED ? t : order.approvedAt
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function chefApprove(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canChefApprove(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能破格通过');
    }
    const t = clock();
    const reason = trim(payload.reason).slice(0, catalog.MAX_REASON_LEN);
    const rounds = (order.praiseRounds || []).map((round, index, list) => {
      if (index !== list.length - 1) return round;
      return Object.assign({}, round, {
        verdict: 'approved',
        reviewedBy: 'chef',
        reason: reason,
        reviewedAt: t
      });
    });
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.REJECTED, {
      status: orderStatus.STATUS.APPROVED,
      praiseRounds: rounds,
      approvedAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function chefReject(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canChefReject(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能打回');
    }
    const t = clock();
    const reason = trim(payload.reason).slice(0, catalog.MAX_REASON_LEN) || '还不够走心';
    const demand = trim(payload.demand).slice(0, catalog.MAX_DEMAND_LEN);
    const rounds = (order.praiseRounds || []).map((round, index, list) => {
      if (index !== list.length - 1) return round;
      return Object.assign({}, round, {
        verdict: 'rejected',
        reviewedBy: 'chef',
        reason: reason,
        demand: demand,
        reviewedAt: t
      });
    });
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.APPROVED, {
      status: orderStatus.STATUS.REJECTED,
      praiseRounds: rounds,
      rejectedAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function claimPayment(ctx, payload) {
    const me = await requireDiner(ctx);
    const order = await loadOrder(payload.orderId);
    if (order.dinerOpenid !== me._id) fail(CODES.FORBIDDEN, '这不是你的订单');
    if (!orderStatus.canClaim(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能报转账');
    }
    const t = clock();
    const note = trim(payload.note).slice(0, catalog.MAX_NOTE_LEN);
    const payment = Object.assign({}, order.payment || {}, {
      claimedAt: t,
      note: note,
      rejectedAt: null,
      rejectReason: ''
    });
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.APPROVED, {
      status: orderStatus.STATUS.PAYMENT_CLAIMED,
      payment: payment,
      paymentClaimedAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function confirmPayment(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canConfirm(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能确认收款');
    }
    const t = clock();
    const payment = Object.assign({}, order.payment || {}, { confirmedAt: t });
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.PAYMENT_CLAIMED, {
      status: orderStatus.STATUS.PAID,
      payment: payment,
      paidAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function rejectPaymentClaim(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canRejectClaim(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能退回收款');
    }
    const t = clock();
    const reason = trim(payload.reason).slice(0, catalog.MAX_REASON_LEN) || '没收到';
    const payment = Object.assign({}, order.payment || {}, {
      rejectedAt: t,
      rejectReason: reason
    });
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.PAYMENT_CLAIMED, {
      status: orderStatus.STATUS.APPROVED,
      payment: payment,
      paymentClaimedAt: null,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function startCooking(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canStart(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能开火');
    }
    const t = clock();
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.PAID, {
      status: orderStatus.STATUS.COOKING,
      cookingAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function finishCooking(ctx, payload) {
    await requireChef(ctx);
    const order = await loadOrder(payload.orderId);
    if (!orderStatus.canFinish(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能出锅');
    }
    const t = clock();
    const changed = await repo.updateOrder(order._id, orderStatus.STATUS.COOKING, {
      status: orderStatus.STATUS.SERVED,
      servedAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function cancelOrder(ctx, payload) {
    const me = await requireBound(ctx);
    const order = await loadOrder(payload.orderId);
    if (me.role === 'diner' && order.dinerOpenid !== me._id) {
      fail(CODES.FORBIDDEN, '这不是你的订单');
    }
    if (!orderStatus.canCancel(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不能取消');
    }
    const t = clock();
    const reason = trim(payload.reason).slice(0, catalog.MAX_REASON_LEN);
    const changed = await repo.updateOrder(order._id, order.status, {
      status: orderStatus.STATUS.CANCELLED,
      cancelledAt: t,
      cancelReason: reason,
      cancelledBy: me.role,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { order: await repo.getOrder(order._id) };
  }

  async function nudge(ctx, payload) {
    const me = await requireDiner(ctx);
    const order = await loadOrder(payload.orderId);
    if (order.dinerOpenid !== me._id) fail(CODES.FORBIDDEN, '这不是你的订单');
    if (!orderStatus.canNudge(order.status)) {
      fail(CODES.INVALID_STATUS, '这一单现在不用催');
    }
    const t = clock();
    const nudgeCount = (order.nudgeCount || 0) + 1;
    const changed = await repo.updateOrder(order._id, order.status, {
      nudgeCount: nudgeCount,
      lastNudgeAt: t,
      updatedAt: t
    });
    if (!changed) fail(CODES.CONFLICT, '这一单刚刚变过，刷新再试');
    return { nudgeCount: nudgeCount };
  }

  async function listOrders(ctx, payload) {
    const me = await requireBound(ctx);
    const filter = payload.filter || 'all';
    let orders = me.role === 'chef'
      ? await repo.listAllOrders(100)
      : await repo.listOrdersByDiner(me._id, 100);
    if (filter === 'active') {
      orders = orders.filter(order => orderStatus.isActive(order.status));
    } else if (filter === 'served') {
      orders = orders.filter(order => order.status === orderStatus.STATUS.SERVED);
    }
    orders = orders.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    return { orders: orders.map(summarize), filter: filter };
  }

  async function getOrder(ctx, payload) {
    const me = await requireBound(ctx);
    const order = await loadOrder(payload.orderId || payload.id);
    if (me.role !== 'chef' && order.dinerOpenid !== me._id) {
      fail(CODES.FORBIDDEN, '这不是你的订单');
    }
    const settings = await ensureSettings();
    return {
      order: order,
      role: me.role,
      settings: publicSettings(settings),
      actions: orderStatus.actionsFor(order, me.role)
    };
  }

  async function getPraiseWall(ctx) {
    await requireBound(ctx);
    const orders = await repo.listAllOrders(200);
    const high = [];
    const low = [];
    orders.forEach(order => {
      (order.praiseRounds || []).forEach(round => {
        const item = {
          orderId: order._id,
          orderNo: order.orderNo,
          orderStatus: order.status,
          createdAt: round.createdAt,
          dishes: (order.items || []).map(i => i.name),
          text: round.text,
          score: round.score,
          breakdown: round.breakdown,
          hardFail: round.hardFail || [],
          suggestions: round.suggestions || [],
          verdict: round.verdict,
          reviewedBy: round.reviewedBy,
          reason: round.reason || '',
          demand: round.demand || '',
          round: round.round
        };
        if (round.verdict === 'approved') high.push(item);
        else if (round.verdict === 'rejected') low.push(item);
      });
    });
    const byTime = (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    high.sort(byTime);
    low.sort(byTime);
    return { high: high.slice(0, 100), low: low.slice(0, 100) };
  }

  async function getStats(ctx) {
    await requireBound(ctx);
    const orders = await repo.listAllOrders(200);
    const served = orders.filter(order => order.status === orderStatus.STATUS.SERVED);
    const paid = orders.filter(order => (
      order.status === orderStatus.STATUS.PAID ||
      order.status === orderStatus.STATUS.COOKING ||
      order.status === orderStatus.STATUS.SERVED
    ));
    const valid = orders.filter(order => order.status !== orderStatus.STATUS.CANCELLED);
    const approvedRounds = [];
    const rejectedRounds = [];
    valid.forEach(order => {
      (order.praiseRounds || []).forEach(round => {
        if (round.verdict === 'approved') approvedRounds.push(round);
        else if (round.verdict === 'rejected') rejectedRounds.push(round);
      });
    });
    const totalCents = paid.reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
    const totalChars = approvedRounds.reduce((sum, round) => sum + effectiveLength(round.text), 0);
    const maxScore = approvedRounds.reduce((max, round) => Math.max(max, Number(round.score) || 0), 0);
    const avgRounds = served.length
      ? served.reduce((sum, order) => sum + (Number(order.roundCount) || (order.praiseRounds || []).length), 0) / served.length
      : 0;
    const todayServed = served.filter(order => order.servedAt && fmt.sameDayCST(order.servedAt, clock())).length;
    return {
      stats: {
        totalOrders: orders.length,
        servedOrders: served.length,
        paidOrders: paid.length,
        totalCents: totalCents,
        totalChars: totalChars,
        maxScore: maxScore,
        avgRounds: Number(avgRounds.toFixed(1)),
        rejectedRounds: rejectedRounds.length,
        todayServed: todayServed
      }
    };
  }

  const ACTIONS = {
    bootstrap: bootstrap,
    init: init,
    bindRole: bindRole,
    updateProfile: updateProfile,
    updateKitchen: updateKitchen,
    updatePraiseConfig: updatePraiseConfig,
    getMenu: getMenu,
    saveDish: saveDish,
    deleteDish: deleteDish,
    createOrder: createOrder,
    resubmitPraise: resubmitPraise,
    chefApprove: chefApprove,
    chefReject: chefReject,
    claimPayment: claimPayment,
    confirmPayment: confirmPayment,
    rejectPaymentClaim: rejectPaymentClaim,
    startCooking: startCooking,
    finishCooking: finishCooking,
    cancelOrder: cancelOrder,
    nudge: nudge,
    listOrders: listOrders,
    getOrder: getOrder,
    getPraiseWall: getPraiseWall,
    getStats: getStats
  };

  async function dispatch(action, ctx, payload) {
    const fn = ACTIONS[action];
    if (!fn) fail(CODES.UNKNOWN_ACTION, '未知操作：' + action);
    return fn(ctx || {}, payload || {});
  }

  return {
    dispatch: dispatch,
    _actions: ACTIONS
  };
}

module.exports = {
  createService: createService,
  AppError: AppError,
  CODES: CODES
};
