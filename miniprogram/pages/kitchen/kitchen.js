'use strict';

const fmt = require('../../shared/format');
const status = require('../../shared/order-status');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

function greetingFor(hour) {
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function activeView(order, role) {
  if (!order) return null;
  let action = '去处理';
  if (order.status === status.STATUS.REJECTED) action = '去审批';
  else if (order.status === status.STATUS.APPROVED) action = '盯着转账';
  else if (order.status === status.STATUS.PAYMENT_CLAIMED) action = '去确认收款';
  else if (order.status === status.STATUS.PAID) action = '去开火';
  else if (order.status === status.STATUS.COOKING) action = '去出锅';
  return {
    _id: order._id,
    orderNo: order.orderNo,
    status: order.status,
    statusLabel: order.statusLabel,
    latestScore: order.latestScore,
    roundCount: order.roundCount,
    dishText: (order.items && order.items.length
      ? order.items.map(item => item.name + (item.custom ? '（自点）' : ''))
      : (order.dishNames || [])).join('、'),
    totalText: fmt.formatMoney(order.totalCents),
    timeText: fmt.relativeTime(order.createdAt),
    copy: status.statusCopy(order.status, role || 'chef'),
    action: action
  };
}

Page({
  data: {
    loading: true,
    error: '',
    greeting: '你好',
    user: null,
    partner: null,
    settings: null,
    kitchenOpen: true,
    kitchenNote: '',
    stats: null,
    totalText: '¥0',
    maxScoreText: '—',
    avgRoundsText: '—',
    activeOrder: null,
    praises: [],
    dishCount: 0,
    savingNote: false,
    toggling: false
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
        selectedKey: 'kitchen',
        role: getApp().globalData.role || 'chef'
      });
    }
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady('chef');
      if (!boot) return;
      const results = await Promise.all([
        api.call('getStats', {}),
        api.call('getPraiseWall', {}),
        api.call('getMenu', {})
      ]);
      const stats = results[0].stats;
      const high = results[1].high || [];
      const dishes = results[2].dishes || [];
      const praises = high.slice(0, 5).map(item => ({
        key: item.orderId + '_' + item.round,
        score: item.score,
        text: item.text,
        dishesText: (item.dishes || []).join('、'),
        timeText: fmt.relativeTime(item.createdAt)
      }));

      this.setData({
        loading: false,
        error: '',
        greeting: greetingFor(new Date().getHours()),
        user: boot.user,
        partner: boot.partner,
        settings: boot.settings,
        kitchenOpen: boot.settings.kitchenOpen,
        kitchenNote: boot.settings.kitchenNote,
        stats: stats,
        totalText: fmt.formatMoney(stats.totalCents),
        maxScoreText: stats.maxScore ? String(stats.maxScore) : '—',
        avgRoundsText: stats.avgRounds ? String(stats.avgRounds) : '—',
        activeOrder: activeView(boot.activeOrder, 'chef'),
        praises: praises,
        dishCount: dishes.length
      });
      this.loadedOnce = true;
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  applySettings(settings) {
    this.setData({
      settings: settings,
      kitchenOpen: settings.kitchenOpen,
      kitchenNote: settings.kitchenNote
    });
    const app = getApp();
    if (app && app.globalData) app.globalData.settings = settings;
  },

  async onToggleOpen(event) {
    if (this.data.toggling) return;
    const open = !!event.detail.value;
    this.setData({ kitchenOpen: open, toggling: true });
    try {
      const result = await api.call('updateKitchen', { open: open });
      this.applySettings(result.settings);
      ui.success(open ? '开门营业' : '今天歇业');
    } catch (error) {
      this.setData({ kitchenOpen: !open });
      ui.toastError(error);
    } finally {
      this.setData({ toggling: false });
    }
  },

  onNoteInput(event) {
    this.setData({ kitchenNote: event.detail.value });
  },

  async onSaveNote() {
    if (this.data.savingNote) return;
    this.setData({ savingNote: true });
    try {
      const result = await api.call('updateKitchen', { note: this.data.kitchenNote });
      this.applySettings(result.settings);
      ui.success('公告已更新');
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.setData({ savingNote: false });
    }
  },

  onActiveTap() {
    if (!this.data.activeOrder) return;
    wx.navigateTo({
      url: '/pages/order-detail/order-detail?orderId=' + this.data.activeOrder._id
    });
  },

  onGoOrders() {
    wx.switchTab({ url: '/pages/orders/orders' });
  },

  onGoPraiseWall() {
    wx.switchTab({ url: '/pages/praise-wall/praise-wall' });
  },

  onGoMenu() {
    wx.navigateTo({ url: '/pages/menu-manage/menu-manage' });
  },

  onGoMe() {
    wx.switchTab({ url: '/pages/me/me' });
  },

  onRetry() {
    this.load();
  },

  onShareAppMessage() {
    return {
      title: '夸夸食堂，先夸后吃',
      path: '/pages/home/home'
    };
  }
});
