'use strict';

const cloud = require('wx-server-sdk');
const { ACTIVE } = require('./lib/order-status');

const SETTINGS_ID = 'main';
const COLLECTIONS = ['users', 'settings', 'dishes', 'orders'];

function stripId(doc) {
  const out = Object.assign({}, doc);
  delete out._id;
  return out;
}

function isCollectionExists(error) {
  const code = error && (error.errCode || error.code);
  const msg = String(error && (error.errMsg || error.message) || error || '');
  return code === -501001 ||
    code === 'ResourceUnavailable.ResourceExist' ||
    /already exists|already exist|ResourceExist|Table exist|TABLE_EXIST|DATABASE_COLLECTION_ALREADY_EXIST|已经存在|集合已存在/i.test(msg);
}

function missingDoc(data) {
  return !data || !data.length;
}

function createCloudRepo() {
  const db = cloud.database();
  const _ = db.command;
  let collectionsReady = false;

  async function getSettings() {
    const res = await db.collection('settings').where({ _id: SETTINGS_ID }).limit(1).get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function saveSettings(settings) {
    const data = stripId(settings);
    await db.collection('settings').doc(SETTINGS_ID).set({ data: data });
    return Object.assign({ _id: SETTINGS_ID }, data);
  }

  async function claimRoleSlot(role, openid) {
    const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
    const res = await db.collection('settings')
      .where({ _id: SETTINGS_ID, [field]: null })
      .update({ data: { [field]: openid, updatedAt: Date.now() } });
    return !!(res.stats && res.stats.updated === 1);
  }

  async function releaseRoleSlot(role, openid) {
    const field = role === 'chef' ? 'chefOpenid' : 'dinerOpenid';
    await db.collection('settings')
      .where({ _id: SETTINGS_ID, [field]: openid })
      .update({ data: { [field]: null, updatedAt: Date.now() } });
    return true;
  }

  async function listUsers() {
    const res = await db.collection('users').limit(10).get();
    return res.data;
  }

  async function getUser(openid) {
    const res = await db.collection('users').where({ _id: openid }).limit(1).get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function getFirstUserByRole(role) {
    const res = await db.collection('users').where({ role: role }).limit(1).get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function countUsersByRole(role) {
    const res = await db.collection('users').where({ role: role }).count();
    return Number(res.total) || 0;
  }

  async function createUser(user) {
    const data = stripId(user);
    await db.collection('users').doc(user._id).set({ data: data });
    return Object.assign({ _id: user._id }, data);
  }

  async function updateUser(openid, patch) {
    const res = await db.collection('users').doc(openid).update({ data: stripId(patch) });
    if (!res.stats || res.stats.updated !== 1) return null;
    return getUser(openid);
  }

  async function listDishes() {
    const res = await db.collection('dishes').limit(100).get();
    return res.data;
  }

  async function getDish(id) {
    const res = await db.collection('dishes').where({ _id: id }).limit(1).get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function getDishesByIds(ids) {
    if (!ids || !ids.length) return [];
    const res = await db.collection('dishes').where({ _id: _.in(ids) }).limit(100).get();
    return res.data;
  }

  async function createDish(dish) {
    const data = stripId(dish);
    if (dish._id) data._id = dish._id;
    const res = await db.collection('dishes').add({ data: data });
    return Object.assign({ _id: res._id }, data);
  }

  async function updateDish(id, patch) {
    const res = await db.collection('dishes').doc(id).update({ data: stripId(patch) });
    if (!res.stats || res.stats.updated !== 1) return null;
    return getDish(id);
  }

  async function deleteDish(id) {
    const res = await db.collection('dishes').doc(id).remove();
    return !!(res.stats && res.stats.removed === 1);
  }

  async function getRecentOrdersByDiner(openid, limit) {
    const res = await db.collection('orders')
      .where({ dinerOpenid: openid })
      .orderBy('createdAt', 'desc')
      .limit(limit || 10)
      .get();
    return res.data;
  }

  async function findActiveOrder(dinerOpenid) {
    const where = { status: _.in(ACTIVE) };
    if (dinerOpenid) where.dinerOpenid = dinerOpenid;
    const res = await db.collection('orders')
      .where(where)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function listActiveOrders() {
    const res = await db.collection('orders')
      .where({ status: _.in(ACTIVE) })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    return res.data || [];
  }

  async function findOrderByClientToken(dinerOpenid, token) {
    if (!token) return null;
    const res = await db.collection('orders')
      .where({ dinerOpenid: dinerOpenid, clientToken: token })
      .limit(1)
      .get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function createOrder(order) {
    const data = stripId(order);
    if (order._id) data._id = order._id;
    const res = await db.collection('orders').add({ data: data });
    return Object.assign({ _id: res._id }, data);
  }

  async function getOrder(id) {
    const res = await db.collection('orders').where({ _id: id }).limit(1).get();
    return missingDoc(res.data) ? null : res.data[0];
  }

  async function updateOrder(id, expectedStatus, patch) {
    const res = await db.collection('orders')
      .where({ _id: id, status: expectedStatus })
      .update({ data: stripId(patch) });
    return !!(res.stats && res.stats.updated === 1);
  }

  async function listAllOrders(limit) {
    const res = await db.collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(limit || 100)
      .get();
    return res.data;
  }

  async function listOrdersByDiner(openid, limit) {
    const res = await db.collection('orders')
      .where({ dinerOpenid: openid })
      .orderBy('createdAt', 'desc')
      .limit(limit || 100)
      .get();
    return res.data;
  }

  async function ensureCollections() {
    if (collectionsReady) return;
    if (typeof db.createCollection !== 'function') {
      collectionsReady = true;
      return;
    }
    for (let i = 0; i < COLLECTIONS.length; i++) {
      const name = COLLECTIONS[i];
      try {
        await db.createCollection(name);
      } catch (error) {
        if (isCollectionExists(error)) continue;
        const detail = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : String(error);
        throw new Error('数据库初始化失败：' + detail + '。请在云开发控制台手动创建 users/settings/dishes/orders 四个集合。');
      }
    }
    collectionsReady = true;
  }

  return {
    ensureCollections: ensureCollections,
    getSettings: getSettings,
    saveSettings: saveSettings,
    claimRoleSlot: claimRoleSlot,
    releaseRoleSlot: releaseRoleSlot,
    listUsers: listUsers,
    getUser: getUser,
    getFirstUserByRole: getFirstUserByRole,
    countUsersByRole: countUsersByRole,
    createUser: createUser,
    updateUser: updateUser,
    listDishes: listDishes,
    getDish: getDish,
    getDishesByIds: getDishesByIds,
    createDish: createDish,
    updateDish: updateDish,
    deleteDish: deleteDish,
    getRecentOrdersByDiner: getRecentOrdersByDiner,
    findActiveOrder: findActiveOrder,
    listActiveOrders: listActiveOrders,
    findOrderByClientToken: findOrderByClientToken,
    createOrder: createOrder,
    getOrder: getOrder,
    updateOrder: updateOrder,
    listAllOrders: listAllOrders,
    listOrdersByDiner: listOrdersByDiner
  };
}

module.exports = { createCloudRepo };
