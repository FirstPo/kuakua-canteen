'use strict';

const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

const FILTERS = [
  { key: 'active', label: '进行中' },
  { key: 'all', label: '全部' },
  { key: 'served', label: '已出餐' }
];

Page({
  data: {
    loading: true,
    error: '',
    role: 'diner',
    filter: 'active',
    filters: FILTERS,
    orders: [],
    emptyText: '',
    emptyActionText: '去点菜'
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
        selectedKey: 'orders',
        role: getApp().globalData.role || 'diner'
      });
    }
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady();
      if (!boot) return;
      const result = await api.call('listOrders', { filter: this.data.filter });
      const role = boot.role;
      this.setData({
        loading: false,
        error: '',
        role: role,
        orders: result.orders || [],
        emptyText: this.data.filter === 'served'
          ? '还没有吃完的单。'
          : (this.data.filter === 'active' ? '眼下没有进行中的订单。' : '还没有订单。'),
        emptyActionText: role === 'chef' ? '回厨房' : '去点菜'
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onFilter(event) {
    const key = event.currentTarget.dataset.key;
    if (!key || key === this.data.filter) return;
    this.setData({ filter: key });
    this.load(true);
  },

  onOrderTap(event) {
    const id = event.detail && event.detail.id;
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
