'use strict';

const { ACTIVE } = require('../shared/order-status');

const STORAGE_KEY = 'kuakua_demo_v1';

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return {
    settings: null,
    users: [],
    dishes: [],
    orders: [],
    seq: 0,
    currentOpenid: ''
  };
}

function loadState() {
  let raw = null;
  try {
    raw = wx.getStorageSync(STORAGE_KEY);
  } catch (error) {
    raw = null;
  }
  if (!raw) return emptyState();
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      return emptyState();
    }
  }
  if (!raw || typeof raw !== 'object') return emptyState();
  return {
    settings: raw.settings || null,
    users: Array.isArray(raw.users) ? raw.users : [],
    dishes: Array.isArray(raw.dishes) ? raw.dishes : [],
    orders: Array.isArray(raw.orders) ? raw.orders : [],
    seq: Number(raw.seq) || 0,
    currentOpenid: raw.currentOpenid || ''
  };
}

function createMockRepo() {
  let state = loadState();

  function persist() {
    try {
      wx.setStorageSync(STORAGE_KEY, state);
    } catch (error) {
      console.error('[mock-repo] 本地存储失败', error);
    }
  }

  function nextId(prefix) {
    state.seq += 1;
    return prefix + '_' + String(state.seq).padStart(4, '0');
  }

  function settingsDoc() {
    if (!state.settings) {
      state.settings = {
        _id: 'main',
        chefOpenid: null,
        dinerOpenid: null,
        passScore: 80,
        minLen: 20,
        kitchenOpen: true,
        kitchenNote: '',
        seeded: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
    return state.settings;
  }

  function byNewest(a, b) {
    const time = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    if (time !== 0) return time;
    return String(b._id).localeCompare(String(a._id));
  }

  return {
    async ensureCollections() {
      return true;
    },

    async getSettings() {
      return clone(state.settings);
    },

    async saveSettings(settings) {
      state.settings = clone(settings);
      state.settings._id = 'main';
      persist();
      return clone(state.settings);
    },

    async listUsers() {
      return clone(state.users);
    },

    async getUser(openid) {
      const user = state.users.find(item => item._id === openid);
      return user ? clone(user) : null;
    },

    async getFirstUserByRole(role) {
      const user = state.users.find(item => item.role === role);
      return user ? clone(user) : null;
    },

    async countUsersByRole(role) {
      return state.users.filter(item => item.role === role).length;
    },

    async createUser(user) {
      if (state.users.some(item => item._id === user._id)) {
        throw new Error('USER_EXISTS');
      }
      state.users.push(clone(user));
      persist();
      return clone(user);
    },

    async updateUser(openid, patch) {
      const user = state.users.find(item => item._id === openid);
      if (!user) return null;
      Object.assign(user, clone(patch));
      persist();
      return clone(user);
    },

    async claimRoleSlot(role, openid) {
      const settings = settingsDoc();
      const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
      if (settings[field] && settings[field] !== openid) return false;
      settings[field] = openid;
      persist();
      return true;
    },

    async releaseRoleSlot(role, openid) {
      const settings = settingsDoc();
      const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
      if (settings[field] === openid) {
        settings[field] = null;
        persist();
      }
      return true;
    },

    async listDishes() {
      return clone(state.dishes);
    },

    async getDish(id) {
      const dish = state.dishes.find(item => item._id === id);
      return dish ? clone(dish) : null;
    },

    async getDishesByIds(ids) {
      const wanted = new Set(ids || []);
      return clone(state.dishes.filter(item => wanted.has(item._id)));
    },

    async createDish(dish) {
      const doc = clone(dish);
      if (!doc._id) doc._id = nextId('dish');
      if (state.dishes.some(item => item._id === doc._id)) {
        throw new Error('DISH_EXISTS');
      }
      state.dishes.push(doc);
      persist();
      return clone(doc);
    },

    async updateDish(id, patch) {
      const dish = state.dishes.find(item => item._id === id);
      if (!dish) return null;
      Object.assign(dish, clone(patch));
      persist();
      return clone(dish);
    },

    async deleteDish(id) {
      const before = state.dishes.length;
      state.dishes = state.dishes.filter(item => item._id !== id);
      if (state.dishes.length !== before) persist();
      return state.dishes.length !== before;
    },

    async getRecentOrdersByDiner(openid, limit) {
      return clone(
        state.orders
          .filter(order => order.dinerOpenid === openid)
          .sort(byNewest)
          .slice(0, limit || 10)
      );
    },

    async findActiveOrder(dinerOpenid) {
      const orders = state.orders
        .filter(order => ACTIVE.indexOf(order.status) >= 0)
        .filter(order => !dinerOpenid || order.dinerOpenid === dinerOpenid)
        .sort(byNewest);
      return orders.length ? clone(orders[0]) : null;
    },

    async listActiveOrders() {
      return clone(
        state.orders
          .filter(order => ACTIVE.indexOf(order.status) >= 0)
          .sort(byNewest)
          .slice(0, 20)
      );
    },

    async findOrderByClientToken(dinerOpenid, token) {
      if (!token) return null;
      const order = state.orders.find(item => (
        item.dinerOpenid === dinerOpenid && item.clientToken === token
      ));
      return order ? clone(order) : null;
    },

    async createOrder(order) {
      const doc = clone(order);
      if (!doc._id) doc._id = nextId('order');
      if (state.orders.some(item => item._id === doc._id)) {
        throw new Error('ORDER_EXISTS');
      }
      state.orders.push(doc);
      persist();
      return clone(doc);
    },

    async getOrder(id) {
      const order = state.orders.find(item => item._id === id);
      return order ? clone(order) : null;
    },

    async updateOrder(id, expectedStatus, patch) {
      const order = state.orders.find(item => item._id === id);
      if (!order || order.status !== expectedStatus) return false;
      Object.assign(order, clone(patch));
      persist();
      return true;
    },

    async listAllOrders(limit) {
      return clone(state.orders.slice().sort(byNewest).slice(0, limit || 100));
    },

    async listOrdersByDiner(openid, limit) {
      return clone(
        state.orders
          .filter(order => order.dinerOpenid === openid)
          .sort(byNewest)
          .slice(0, limit || 100)
      );
    },

    getCurrentOpenid() {
      return state.currentOpenid || '';
    },

    setCurrentOpenid(openid) {
      state.currentOpenid = openid || '';
      persist();
    },

    reset() {
      state = emptyState();
      persist();
    }
  };
}

module.exports = {
  createMockRepo: createMockRepo,
  STORAGE_KEY: STORAGE_KEY
};
