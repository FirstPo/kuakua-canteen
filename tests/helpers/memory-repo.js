'use strict';

const { ACTIVE } = require('../../shared/order-status');

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function createMemoryRepo() {
  const state = {
    settings: null,
    users: [],
    dishes: [],
    orders: []
  };
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return prefix + '_' + String(seq).padStart(4, '0');
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
        createdAt: 0,
        updatedAt: 0
      };
    }
    return state.settings;
  }

  function byNewest(a, b) {
    const t = (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    if (t !== 0) return t;
    return String(b._id).localeCompare(String(a._id));
  }

  return {
    _state: state,

    async ensureCollections() {
      return true;
    },

    async getSettings() {
      return clone(state.settings);
    },

    async saveSettings(settings) {
      state.settings = clone(settings);
      state.settings._id = 'main';
      return clone(state.settings);
    },

    async listUsers() {
      return clone(state.users);
    },

    async getUser(openid) {
      const user = state.users.find(item => item._id === openid);
      return user ? clone(user) : null;
    },

    async createUser(user) {
      if (state.users.some(item => item._id === user._id)) {
        throw new Error('USER_EXISTS');
      }
      state.users.push(clone(user));
      return clone(user);
    },

    async updateUser(openid, patch) {
      const user = state.users.find(item => item._id === openid);
      if (!user) return null;
      Object.assign(user, clone(patch));
      return clone(user);
    },

    async claimRoleSlot(role, openid) {
      const settings = settingsDoc();
      const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
      if (settings[field] && settings[field] !== openid) return false;
      settings[field] = openid;
      return true;
    },

    async releaseRoleSlot(role, openid) {
      const settings = settingsDoc();
      const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
      if (settings[field] === openid) settings[field] = null;
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
      return clone(doc);
    },

    async updateDish(id, patch) {
      const dish = state.dishes.find(item => item._id === id);
      if (!dish) return null;
      Object.assign(dish, clone(patch));
      return clone(dish);
    },

    async deleteDish(id) {
      const before = state.dishes.length;
      state.dishes = state.dishes.filter(item => item._id !== id);
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
    }
  };
}

module.exports = { createMemoryRepo };
