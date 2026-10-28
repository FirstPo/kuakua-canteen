'use strict';

const customDish = require('../../shared/custom-dish');
const fmt = require('../../shared/format');
const { gradeFor, effectiveLength, HARD_FAIL_LABELS } = require('../../shared/praise-score');
const status = require('../../shared/order-status');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

Page({
  data: {
    loading: true,
    error: '',
    orderId: '',
    orderNo: '',
    round: null,
    roundIndex: 0,
    passed: false,
    grade: null,
    stampClass: 'stamp',
    totalText: '¥0',
    passScore: 80,
    minLen: 20,
    hasCustom: false,
    effLen: 0,
    displayScore: 0,
    hardFailTexts: [],
    suggestions: [],
    chefReason: '',
    chefDemand: '',
    orderStatusLabel: '',
    actions: [],
    zero: 0
  },

  onLoad(options) {
    this.orderId = (options && options.orderId) || '';
    this.setData({ orderId: this.orderId });
    this.load();
  },

  onUnload() {
    this.stopAnimation();
  },

  stopAnimation() {
    if (this.scoreTimer) {
      clearInterval(this.scoreTimer);
      this.scoreTimer = null;
    }
  },

  async load() {
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少订单号' });
      return;
    }
    try {
      const boot = await session.requireReady('diner');
      if (!boot) return;
      const detail = await api.call('getOrder', { orderId: this.orderId });
      const order = detail.order;
      const rounds = order.praiseRounds || [];
      if (!rounds.length) {
        this.setData({ loading: false, error: '这一单还没有夸奖记录' });
        return;
      }
      const index = rounds.length - 1;
      const round = rounds[index];
      const passed = round.verdict === 'approved';
      const grade = gradeFor(round.score, passed);
      const chefReason = round.reviewedBy === 'chef' ? (round.reason || '') : '';
      const chefDemand = round.reviewedBy === 'chef' ? (round.demand || '') : '';
      const hasCustom = order.hasCustom === true || customDish.hasCustomItems(order.items);
      const passScore = round.passScore != null
        ? round.passScore
        : (order.passScore != null ? order.passScore : detail.settings.passScore);
      const minLen = round.minLen != null
        ? round.minLen
        : (order.minLen != null ? order.minLen : detail.settings.minLen);

      this.setData({
        loading: false,
        error: '',
        orderNo: order.orderNo,
        round: round,
        roundIndex: index,
        passed: passed,
        grade: grade,
        stampClass: passed ? (grade.key === 'pass' ? 'stamp-green' : 'stamp-gold') : 'stamp',
        totalText: fmt.formatMoney(order.totalCents),
        passScore: passScore,
        minLen: minLen,
        hasCustom: hasCustom,
        effLen: effectiveLength(round.text),
        displayScore: 0,
        hardFailTexts: (round.hardFail || []).map(key => HARD_FAIL_LABELS[key] || key),
        suggestions: round.suggestions || [],
        chefReason: chefReason,
        chefDemand: chefDemand,
        orderStatusLabel: status.statusLabel(order.status),
        actions: detail.actions || []
      });
      this.animateScore(Number(round.score) || 0);
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  animateScore(target) {
    this.stopAnimation();
    if (target <= 0) {
      this.setData({ displayScore: target });
      return;
    }
    const start = Date.now();
    const duration = 720;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.setData({ displayScore: Math.round(target * eased) });
      if (progress >= 1) this.stopAnimation();
    };
    this.scoreTimer = setInterval(tick, 32);
    tick();
  },

  onPrimary() {
    const url = this.data.passed
      ? '/pages/order-detail/order-detail?orderId=' + this.orderId
      : '/pages/praise/praise?orderId=' + this.orderId;
    wx.redirectTo({ url: url });
  },

  onDetail() {
    wx.redirectTo({
      url: '/pages/order-detail/order-detail?orderId=' + this.orderId
    });
  },

  onRetry() {
    this.setData({ loading: true, error: '' });
    this.load();
  }
});
