'use strict';

const catalog = require('./catalog');

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  const v = Math.round(n);
  if (v < min || v > max) return fallback;
  return v;
}

function isCustomId(id) {
  return String(id == null ? '' : id).indexOf(catalog.CUSTOM_ITEM_PREFIX) === 0;
}

function isCustomItem(item) {
  if (!item) return false;
  return item.custom === true || isCustomId(item.dishId);
}

function hasCustomItems(items) {
  return Array.isArray(items) && items.some(isCustomItem);
}

function thresholdsFor(settings, hasCustom) {
  const source = settings || {};
  const basePass = clampInt(source.passScore, 60, 100, catalog.DEFAULT_PASS_SCORE);
  const baseMinLen = clampInt(source.minLen, 10, 50, catalog.DEFAULT_MIN_LEN);
  if (!hasCustom) {
    return { passScore: basePass, minLen: baseMinLen, raised: false };
  }
  return {
    passScore: Math.min(100, basePass + catalog.CUSTOM_PASS_BONUS),
    minLen: Math.min(catalog.MAX_CUSTOM_MIN_LEN, baseMinLen + catalog.CUSTOM_MIN_LEN_BONUS),
    raised: true
  };
}

module.exports = {
  isCustomId,
  isCustomItem,
  hasCustomItems,
  thresholdsFor
};
