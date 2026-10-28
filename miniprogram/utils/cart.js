'use strict';

const customDish = require('../shared/custom-dish');

const KEY = 'kuakua_cart_v2';
const LEGACY_KEY = 'kuakua_cart_v1';

function parse(value) {
  if (typeof value === 'string' && value) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  return value;
}

function sanitizeCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name == null ? '' : raw.name).trim();
  if (!name) return null;
  const priceCents = Math.round(Number(raw.priceCents));
  if (!isFinite(priceCents) || priceCents <= 0) return null;
  return {
    name: name,
    desc: String(raw.desc == null ? '' : raw.desc).trim(),
    emoji: String(raw.emoji == null ? '' : raw.emoji).trim() || '🍲',
    priceCents: priceCents
  };
}

function normalizeDoc(raw) {
  const source = parse(raw);
  const items = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { version: 2, items: items };
  }
  const sourceItems = source.version === 2 && source.items && typeof source.items === 'object'
    ? source.items
    : source;
  Object.keys(sourceItems).forEach(id => {
    if (!id) return;
    const entry = sourceItems[id];
    const isObject = entry && typeof entry === 'object';
    const qty = Math.floor(Number(isObject ? entry.qty : entry));
    if (!isFinite(qty) || qty <= 0) return;
    if (customDish.isCustomId(id)) {
      const custom = isObject ? sanitizeCustom(entry.custom) : null;
      if (custom) items[id] = { qty: qty, custom: custom };
      return;
    }
    items[id] = { qty: qty };
  });
  return { version: 2, items: items };
}

function readDoc() {
  let raw = null;
  try {
    raw = wx.getStorageSync(KEY);
  } catch (error) {
    raw = null;
  }
  if (raw) return normalizeDoc(raw);

  let legacy = null;
  try {
    legacy = wx.getStorageSync(LEGACY_KEY);
  } catch (error) {
    legacy = null;
  }
  if (legacy) {
    const doc = normalizeDoc(legacy);
    writeDoc(doc);
    try {
      wx.removeStorageSync(LEGACY_KEY);
    } catch (error) {
      // ignore
    }
    return doc;
  }
  return { version: 2, items: {} };
}

function writeDoc(doc) {
  try {
    wx.setStorageSync(KEY, normalizeDoc(doc));
  } catch (error) {
    // 存储失败时保留页面内的购物车，不阻塞点菜。
  }
}

function load() {
  const doc = readDoc();
  const map = {};
  Object.keys(doc.items).forEach(id => {
    map[id] = doc.items[id].qty;
  });
  return map;
}

function loadCustom() {
  const doc = readDoc();
  const map = {};
  Object.keys(doc.items).forEach(id => {
    if (doc.items[id].custom) map[id] = doc.items[id].custom;
  });
  return map;
}

function save(map) {
  const doc = readDoc();
  const current = map && typeof map === 'object' ? map : {};
  const next = { version: 2, items: {} };
  Object.keys(current).forEach(id => {
    const qty = Math.floor(Number(current[id]));
    if (!id || !isFinite(qty) || qty <= 0) return;
    const existing = doc.items[id];
    if (customDish.isCustomId(id)) {
      if (existing && existing.custom) {
        next.items[id] = { qty: qty, custom: existing.custom };
      }
      return;
    }
    next.items[id] = { qty: qty };
  });
  writeDoc(next);
}

function setQty(dishId, qty) {
  const doc = readDoc();
  if (!dishId) return load();
  const n = Math.floor(Number(qty));
  if (!isFinite(n) || n <= 0) {
    delete doc.items[dishId];
  } else {
    const existing = doc.items[dishId];
    if (customDish.isCustomId(dishId) && (!existing || !existing.custom)) {
      return load();
    }
    doc.items[dishId] = existing
      ? { qty: n, custom: existing.custom }
      : { qty: n };
  }
  writeDoc(doc);
  return load();
}

function addCustom(raw) {
  const custom = sanitizeCustom(raw);
  if (!custom) return '';
  const doc = readDoc();
  const base = 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  let id = base;
  let salt = 0;
  while (doc.items[id]) {
    salt++;
    id = base + salt;
  }
  doc.items[id] = { qty: 1, custom: custom };
  writeDoc(doc);
  return id;
}

function remove(dishId) {
  return setQty(dishId, 0);
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
    wx.removeStorageSync(LEGACY_KEY);
  } catch (error) {
    // ignore
  }
}

function count(map) {
  const data = map || load();
  return Object.keys(data).reduce((sum, id) => sum + (Number(data[id]) || 0), 0);
}

function totalCents(map, dishes, customMap) {
  const data = map || load();
  const byId = {};
  (dishes || []).forEach(dish => {
    byId[dish._id] = dish;
  });
  const custom = customMap || loadCustom();
  return Object.keys(data).reduce((sum, id) => {
    const qty = Number(data[id]) || 0;
    const customItem = custom[id];
    if (customItem) return sum + (Number(customItem.priceCents) || 0) * qty;
    const dish = byId[id];
    if (!dish) return sum;
    return sum + (Number(dish.priceCents) || 0) * qty;
  }, 0);
}

module.exports = {
  load: load,
  loadCustom: loadCustom,
  save: save,
  setQty: setQty,
  addCustom: addCustom,
  remove: remove,
  clear: clear,
  count: count,
  totalCents: totalCents
};
