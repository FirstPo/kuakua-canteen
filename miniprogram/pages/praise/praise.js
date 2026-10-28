'use strict';

const catalog = require('../../shared/catalog');
const customDish = require('../../shared/custom-dish');
const fmt = require('../../shared/format');
const { effectiveLength, HARD_FAIL_LABELS } = require('../../shared/praise-score');
const status = require('../../shared/order-status');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');
const cart = require('../../utils/cart');
const token = require('../../utils/token');

function promptIndex(current) {
  let next = Math.floor(Math.random() * catalog.PRAISE_PROMPTS.length);
  if (catalog.PRAISE_PROMPTS.length > 1 && next === current) {
    next = (next + 1) % catalog.PRAISE_PROMPTS.length;
  }
  return next;
}

Page({
  data: {
    loading: true,
    error: '',
    mode: 'new',
    orderId: '',
    orderNo: '',
    items: [],
    totalText: '¥0',
    note: '',
    praise: '',
    prompt: '',
    promptIndex: 0,
    minLen: catalog.DEFAULT_MIN_LEN,
    passScore: catalog.DEFAULT_PASS_SCORE,
    maxLen: catalog.MAX_PRAISE_LEN,
    effLen: 0,
    rawLen: 0,
    hasCustom: false,
    previous: null,
    submitting: false,
    activeOrder: null
  },

  onLoad(options) {
    this.draftId = token.makeDraftId();
    this.orderId = (options && options.orderId) || '';
    this.setData({
      mode: this.orderId ? 'repraise' : 'new',
      orderId: this.orderId
    });
    const idx = promptIndex(-1);
    this.setData({
      promptIndex: idx,
      prompt: catalog.PRAISE_PROMPTS[idx]
    });
    this.load();
  },

  async load() {
    try {
      const boot = await session.requireReady('diner');
      if (!boot) return;

      if (!this.orderId && boot.activeOrder) {
        ui.toast('上一单还没结束');
        wx.redirectTo({
          url: '/pages/order-detail/order-detail?orderId=' + boot.activeOrder._id
        });
        return;
      }

      if (this.orderId) {
        const detail = await api.call('getOrder', { orderId: this.orderId });
        const order = detail.order;
        if (order.status !== status.STATUS.REJECTED) {
          wx.redirectTo({
            url: '/pages/order-detail/order-detail?orderId=' + order._id
          });
          return;
        }
        const rounds = order.praiseRounds || [];
        const last = rounds.length ? rounds[rounds.length - 1] : null;
        const hasCustom = order.hasCustom === true || customDish.hasCustomItems(order.items);
        const thresholds = customDish.thresholdsFor(detail.settings, hasCustom);
        const previous = last ? {
          score: last.score,
          verdictLabel: status.roundVerdictLabel(last.verdict, last.reviewedBy),
          reason: last.reason || '',
          demand: last.demand || '',
          suggestions: last.suggestions || [],
          hardFailTexts: (last.hardFail || []).map(key => HARD_FAIL_LABELS[key] || key)
        } : null;
        this.setData({
          loading: false,
          error: '',
          orderNo: order.orderNo,
          items: (order.items || []).map(item => Object.assign({}, item, {
            priceText: fmt.formatMoney(item.lineTotalCents)
          })),
          totalText: fmt.formatMoney(order.totalCents),
          note: order.note || '',
          minLen: thresholds.minLen,
          passScore: thresholds.passScore,
          hasCustom: hasCustom,
          previous: previous
        });
        return;
      }

      const map = cart.load();
      const customMap = cart.loadCustom();
      const menu = await api.call('getMenu', {});
      const byId = {};
      menu.dishes.forEach(dish => {
        byId[dish._id] = dish;
      });
      const items = [];
      Object.keys(map)
        .filter(id => !customDish.isCustomId(id) && byId[id] && byId[id].available && map[id] > 0)
        .forEach(id => {
          const dish = byId[id];
          const qty = map[id];
          items.push({
            dishId: id,
            custom: false,
            name: dish.name,
            emoji: dish.emoji,
            priceCents: dish.priceCents,
            qty: qty,
            lineTotalCents: dish.priceCents * qty,
            priceText: fmt.formatMoney(dish.priceCents * qty)
          });
        });
      Object.keys(map)
        .filter(id => customDish.isCustomId(id) && customMap[id] && map[id] > 0)
        .forEach(id => {
          const custom = customMap[id];
          const qty = map[id];
          items.push({
            dishId: id,
            custom: true,
            name: custom.name,
            desc: custom.desc || '',
            emoji: custom.emoji,
            priceCents: custom.priceCents,
            qty: qty,
            lineTotalCents: custom.priceCents * qty,
            priceText: fmt.formatMoney(custom.priceCents * qty)
          });
        });

      if (!items.length) {
        ui.toast('购物车是空的');
        wx.switchTab({ url: '/pages/home/home' });
        return;
      }

      const hasCustom = items.some(item => item.custom);
      const thresholds = customDish.thresholdsFor(boot.settings, hasCustom);
      const totalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
      this.setData({
        loading: false,
        error: '',
        items: items,
        totalText: fmt.formatMoney(totalCents),
        minLen: thresholds.minLen,
        passScore: thresholds.passScore,
        hasCustom: hasCustom
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onPraise(event) {
    const value = event.detail.value;
    this.setData({
      praise: value,
      effLen: effectiveLength(value),
      rawLen: Array.from(value).length
    });
  },

  onNote(event) {
    this.setData({ note: event.detail.value });
  },

  onNewPrompt() {
    const idx = promptIndex(this.data.promptIndex);
    this.setData({
      promptIndex: idx,
      prompt: catalog.PRAISE_PROMPTS[idx]
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const text = String(this.data.praise || '').trim();
    if (!text) {
      ui.toast('还没夸呢');
      return;
    }

    this.setData({ submitting: true });
    ui.loading('大厨正在看');
    try {
      const clientToken = token.tokenFor(this.draftId, this.orderId || 'new', text);
      let result;
      if (this.orderId) {
        result = await api.call('resubmitPraise', {
          orderId: this.orderId,
          praise: text,
          topic: this.data.prompt,
          clientToken: clientToken
        });
      } else {
        result = await api.call('createOrder', {
          items: this.data.items.map(item => (
            item.custom
              ? {
                custom: true,
                name: item.name,
                desc: item.desc || '',
                emoji: item.emoji,
                priceCents: item.priceCents,
                qty: item.qty
              }
              : { dishId: item.dishId, qty: item.qty }
          )),
          praise: text,
          note: this.data.note,
          topic: this.data.prompt,
          clientToken: clientToken
        });
        cart.clear();
      }
      ui.hideLoading();
      wx.redirectTo({
        url: '/pages/verdict/verdict?orderId=' + result.order._id
      });
    } catch (error) {
      ui.hideLoading();
      this.setData({ submitting: false });
      if (error.code === 'ACTIVE_ORDER' && error.details && error.details.orderId) {
        wx.redirectTo({
          url: '/pages/order-detail/order-detail?orderId=' + error.details.orderId
        });
        return;
      }
      ui.toastError(error);
    }
  },

  onRetry() {
    this.load();
  }
});
