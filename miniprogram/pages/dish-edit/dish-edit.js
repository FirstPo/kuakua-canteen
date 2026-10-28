'use strict';

const catalog = require('../../shared/catalog');
const fmt = require('../../shared/format');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

Page({
  data: {
    loading: false,
    error: '',
    id: '',
    isEdit: false,
    name: '',
    desc: '',
    emoji: '🍜',
    priceInput: '',
    category: '家常',
    available: true,
    categories: catalog.CATEGORIES,
    emojis: catalog.EMOJI_CHOICES,
    maxName: catalog.MAX_DISH_NAME_LEN,
    maxDesc: catalog.MAX_DISH_DESC_LEN,
    saving: false
  },

  onLoad(options) {
    const id = (options && options.id) || '';
    this.setData({ id: id, isEdit: !!id });
    wx.setNavigationBarTitle({ title: id ? '编辑菜品' : '新增菜品' });
    this.init(id);
  },

  async init(id) {
    try {
      const boot = await session.requireReady('chef');
      if (!boot) return;
      if (!id) {
        this.setData({ loading: false, error: '' });
        return;
      }
      this.setData({ loading: true, error: '' });
      const result = await api.call('getMenu', {});
      const dish = (result.dishes || []).find(item => item._id === id);
      if (!dish) {
        this.setData({ loading: false, error: '这道菜不存在，可能已经被删了' });
        return;
      }
      this.setData({
        loading: false,
        error: '',
        name: dish.name,
        desc: dish.desc || '',
        emoji: dish.emoji || '🍽️',
        priceInput: fmt.centsToYuanInput(dish.priceCents),
        category: catalog.CATEGORIES.indexOf(dish.category) >= 0 ? dish.category : catalog.CATEGORIES[0],
        available: dish.available !== false
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  onEmoji(event) {
    this.setData({ emoji: event.currentTarget.dataset.emoji });
  },

  onCategory(event) {
    this.setData({ category: event.currentTarget.dataset.category });
  },

  onAvailable(event) {
    this.setData({ available: !!event.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    const name = String(this.data.name || '').trim();
    if (!name) {
      ui.toast('先给菜起个名');
      return;
    }
    const priceCents = fmt.yuanToCents(this.data.priceInput);
    if (priceCents == null) {
      ui.toast('价格写成 12 或 12.5 这样');
      return;
    }

    const payload = {
      name: name,
      desc: String(this.data.desc || '').trim(),
      emoji: this.data.emoji,
      priceCents: priceCents,
      category: this.data.category,
      available: !!this.data.available
    };
    if (this.data.id) payload.id = this.data.id;

    this.setData({ saving: true });
    ui.loading('保存中');
    try {
      await api.call('saveDish', payload);
      ui.hideLoading();
      ui.success(this.data.isEdit ? '已保存' : '已上新');
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.redirectTo({ url: '/pages/menu-manage/menu-manage' });
          }
        });
      }, 450);
    } catch (error) {
      ui.hideLoading();
      this.setData({ saving: false });
      ui.toastError(error);
    }
  },

  onRetry() {
    if (this.data.id) this.init(this.data.id);
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: '/pages/menu-manage/menu-manage' });
      }
    });
  }
});
