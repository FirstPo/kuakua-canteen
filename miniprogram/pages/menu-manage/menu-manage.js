'use strict';

const fmt = require('../../shared/format');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

Page({
  data: {
    loading: true,
    error: '',
    dishes: [],
    totalCount: 0,
    availableCount: 0,
    busyId: ''
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady('chef');
      if (!boot) return;
      const result = await api.call('getMenu', {});
      const dishes = (result.dishes || []).map(dish => Object.assign({}, dish, {
        priceText: fmt.formatMoney(dish.priceCents),
        available: dish.available !== false
      }));
      this.setData({
        loading: false,
        error: '',
        dishes: dishes,
        totalCount: dishes.length,
        availableCount: dishes.filter(dish => dish.available).length
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' });
  },

  onEdit(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + id });
  },

  async onToggle(event) {
    const id = event.currentTarget.dataset.id;
    const dish = this.data.dishes.find(item => item._id === id);
    if (!dish || this.data.busyId) return;
    const available = !!event.detail.value;
    this.setData({ busyId: id });
    try {
      await api.call('saveDish', {
        id: id,
        name: dish.name,
        desc: dish.desc,
        emoji: dish.emoji,
        priceCents: dish.priceCents,
        category: dish.category,
        available: available
      });
      ui.toast(available ? '已上架' : '已标为售罄');
      await this.load(true);
    } catch (error) {
      ui.toastError(error);
      await this.load(true);
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async onDelete(event) {
    const id = event.currentTarget.dataset.id;
    const dish = this.data.dishes.find(item => item._id === id);
    if (!dish) return;
    const ok = await ui.confirm({
      title: '删掉这道菜？',
      content: '「' + dish.name + '」会从菜单里消失，已经下过的单不受影响。',
      confirmText: '删掉'
    });
    if (!ok) return;
    this.setData({ busyId: id });
    try {
      await api.call('deleteDish', { id: id });
      ui.success('已删除');
      await this.load(true);
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.setData({ busyId: '' });
    }
  },

  onRetry() {
    this.load();
  }
});
