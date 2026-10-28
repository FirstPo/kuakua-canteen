'use strict';

const fmt = require('../../shared/format');
const status = require('../../shared/order-status');
const { HARD_FAIL_LABELS } = require('../../shared/praise-score');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

function countText(value) {
  const n = Number(value) || 0;
  if (n >= 10000) {
    const w = Math.round(n / 1000) / 10;
    return String(w).replace(/\.0$/, '') + ' 万';
  }
  return String(n);
}

function mapEntry(item) {
  return {
    key: item.orderId + '-' + item.round,
    orderId: item.orderId,
    orderNo: item.orderNo,
    round: item.round,
    score: item.score,
    text: item.text,
    dishesText: (item.dishes || []).join('、'),
    timeText: fmt.relativeTime(item.createdAt),
    verdictLabel: status.roundVerdictLabel(item.verdict, item.reviewedBy),
    reason: item.reason || '',
    demand: item.demand || '',
    hardFailTexts: (item.hardFail || []).map(key => HARD_FAIL_LABELS[key] || key),
    suggestions: item.suggestions || []
  };
}

Page({
  data: {
    loading: true,
    error: '',
    role: 'diner',
    activeTab: 'high',
    high: [],
    low: [],
    items: [],
    highCount: 0,
    lowCount: 0,
    maxScoreText: '—',
    charsText: '0',
    avgRoundsText: '—',
    servedText: '0'
  },

  onShow() {
    this.syncTab();
    this.load();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  syncTab() {
    if (typeof this.getTabBar !== 'function') return;
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({
        selectedKey: 'praise-wall',
        role: getApp().globalData.role || 'diner'
      });
    }
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady();
      if (!boot) return;
      const results = await Promise.all([
        api.call('getPraiseWall', {}),
        api.call('getStats', {})
      ]);
      const high = (results[0].high || []).map(mapEntry);
      const low = (results[0].low || []).map(mapEntry);
      const stats = results[1].stats;

      this.setData({
        loading: false,
        error: '',
        role: boot.role,
        high: high,
        low: low,
        items: this.data.activeTab === 'low' ? low : high,
        highCount: high.length,
        lowCount: low.length,
        maxScoreText: stats.maxScore ? String(stats.maxScore) : '—',
        charsText: countText(stats.totalChars),
        avgRoundsText: stats.avgRounds ? String(stats.avgRounds) : '—',
        servedText: String(stats.servedOrders)
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({
      activeTab: tab,
      items: tab === 'low' ? this.data.low : this.data.high
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onItemTap(event) {
    const id = event.currentTarget.dataset.order;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?orderId=' + id });
  },

  onEmptyAction() {
    if (this.data.role === 'chef') {
      wx.switchTab({ url: '/pages/kitchen/kitchen' });
    } else {
      wx.switchTab({ url: '/pages/home/home' });
    }
  },

  onRetry() {
    this.load();
  }
});
