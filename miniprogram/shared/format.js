'use strict';

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function normalizeCents(cents) {
  const n = Number(cents);
  if (!isFinite(n)) return 0;
  return Math.round(n);
}

function formatPrice(cents) {
  const n = normalizeCents(cents);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return fen === 0 ? sign + yuan : sign + yuan + '.' + pad2(fen);
}

function formatMoney(cents) {
  return '¥' + formatPrice(cents);
}

function centsToYuanInput(cents) {
  const n = normalizeCents(cents);
  return (n / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function yuanToCents(input) {
  const s = String(input == null ? '' : input).trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const parts = s.split('.');
  const yuan = parseInt(parts[0], 10);
  const fenText = (parts[1] || '') + '00';
  const fen = parseInt(fenText.slice(0, 2), 10);
  const cents = yuan * 100 + fen;
  if (cents < 0 || cents > 99900) return null;
  return cents;
}

function toDate(ms) {
  const d = new Date(Number(ms) || 0);
  return d;
}

function formatDate(ms) {
  const d = toDate(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatTime(ms) {
  const d = toDate(ms);
  return formatDate(ms) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function startOfDay(ms) {
  const d = toDate(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDay(ms, now) {
  const t = Number(ms) || 0;
  const ref = now == null ? Date.now() : Number(now);
  const day = 24 * 60 * 60 * 1000;
  const diff = startOfDay(ref) - startOfDay(t);
  if (diff === 0) return '今天';
  if (diff === day) return '昨天';
  const d = toDate(t);
  return pad2(d.getMonth() + 1) + '月' + pad2(d.getDate()) + '日';
}

function relativeTime(ms, now) {
  const t = Number(ms) || 0;
  const ref = now == null ? Date.now() : Number(now);
  const diff = ref - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + ' 天前';
  return formatDate(t);
}

function cstParts(ms) {
  const d = new Date((Number(ms) || 0) + 8 * 60 * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}

function sameDayCST(a, b) {
  const x = cstParts(a);
  const y = cstParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function makeOrderNo(ms, random) {
  const p = cstParts(ms);
  const r = typeof random === 'function' ? random() : Math.random();
  const tail = String(Math.floor(r * 10000)).padStart(4, '0');
  return 'K' + p.year + pad2(p.month) + pad2(p.day) + '-' + tail;
}

function clampText(text, max) {
  const s = String(text == null ? '' : text).trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

module.exports = {
  pad2,
  formatPrice,
  formatMoney,
  centsToYuanInput,
  yuanToCents,
  formatDate,
  formatTime,
  formatDay,
  relativeTime,
  sameDayCST,
  makeOrderNo,
  clampText
};
