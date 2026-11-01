'use strict';

const config = require('../../config');
const catalog = require('../../shared/catalog');
const fmt = require('../../shared/format');
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

Page({
  data: {
    loading: true,
    error: '',
    mode: config.MODE,
    isMock: config.MODE === 'mock',
    cloudEnv: config.CLOUD_ENV_ID || '',
    version: '1.0.0',
    role: 'diner',
    roleLabel: '食客',
    isChef: false,
    user: null,
    partner: null,
    dinerCount: 0,
    settings: null,
    joinedText: '',
    nextRole: 'chef',
    nextRoleLabel: '厨师',
    passScore: catalog.DEFAULT_PASS_SCORE,
    minLen: catalog.DEFAULT_MIN_LEN,
    savingConfig: false,
    totalOrders: 0,
    servedOrders: 0,
    maxScoreText: '—',
    charsText: '0',
    avgRoundsText: '—',
    kitchenStatusText: '',
    kitchenNote: '',
    showRules: false,
    mockBusy: '',
    maxNickname: catalog.MAX_NICKNAME_LEN,
    avatars: catalog.AVATAR_CHOICES,
    profile: {
      show: false,
      nickname: '',
      emoji: '',
      saving: false
    }
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
        selectedKey: 'me',
        role: getApp().globalData.role || 'diner'
      });
    }
  },

  applyBoot(boot) {
    const isChef = boot.role === 'chef';
    const settings = boot.settings;
    this.setData({
      role: boot.role,
      roleLabel: isChef ? '厨师' : '食客',
      isChef: isChef,
      user: boot.user,
      partner: boot.partner,
      dinerCount: boot.dinerCount || 0,
      settings: settings,
      joinedText: boot.user && boot.user.createdAt ? fmt.formatDate(boot.user.createdAt) : '',
      nextRole: isChef ? 'diner' : 'chef',
      nextRoleLabel: isChef ? '食客' : '厨师',
      passScore: settings.passScore,
      minLen: settings.minLen,
      kitchenStatusText: settings.kitchenOpen ? '营业中' : '歇业',
      kitchenNote: settings.kitchenNote || ''
    });
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady();
      if (!boot) return;
      this.applyBoot(boot);
      const result = await api.call('getStats', {});
      const stats = result.stats;
      this.setData({
        loading: false,
        error: '',
        totalOrders: stats.totalOrders,
        servedOrders: stats.servedOrders,
        maxScoreText: stats.maxScore ? String(stats.maxScore) : '—',
        charsText: countText(stats.totalChars),
        avgRoundsText: stats.avgRounds ? String(stats.avgRounds) : '—'
      });
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onOpenProfile() {
    this.setData({
      'profile.show': true,
      'profile.nickname': this.data.user ? this.data.user.nickname : '',
      'profile.emoji': this.data.user ? this.data.user.emoji : '🍳',
      'profile.saving': false
    });
  },

  onCloseProfile() {
    if (this.data.profile.saving) return;
    this.setData({ 'profile.show': false });
  },

  onProfileInput(event) {
    this.setData({ 'profile.nickname': event.detail.value });
  },

  onAvatar(event) {
    this.setData({ 'profile.emoji': event.currentTarget.dataset.emoji });
  },

  async onSaveProfile() {
    if (this.data.profile.saving) return;
    const nickname = String(this.data.profile.nickname || '').trim();
    if (!nickname) {
      ui.toast('称呼不能空着');
      return;
    }
    this.setData({ 'profile.saving': true });
    try {
      await api.call('updateProfile', {
        nickname: nickname,
        emoji: this.data.profile.emoji
      });
      const boot = await session.refresh();
      if (boot) this.applyBoot(boot);
      this.setData({ 'profile.show': false, 'profile.saving': false });
      ui.success('资料已更新');
    } catch (error) {
      this.setData({ 'profile.saving': false });
      ui.toastError(error);
    }
  },

  noop() {
    // 阻止点击内容区时关闭弹层。
  },

  onPassChange(event) {
    this.setData({ passScore: Number(event.detail.value) || catalog.DEFAULT_PASS_SCORE });
  },

  onMinLenChange(event) {
    this.setData({ minLen: Number(event.detail.value) || catalog.DEFAULT_MIN_LEN });
  },

  async onSaveConfig() {
    if (!this.data.isChef || this.data.savingConfig) return;
    this.setData({ savingConfig: true });
    try {
      const result = await api.call('updatePraiseConfig', {
        passScore: this.data.passScore,
        minLen: this.data.minLen
      });
      const settings = result.settings;
      this.setData({
        settings: settings,
        passScore: settings.passScore,
        minLen: settings.minLen
      });
      const app = getApp();
      if (app && app.globalData) app.globalData.settings = settings;
      ui.success('标准已更新');
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.setData({ savingConfig: false });
    }
  },

  onKitchenRow() {
    if (this.data.isChef) {
      wx.switchTab({ url: '/pages/kitchen/kitchen' });
      return;
    }
    ui.toast(this.data.kitchenNote || (this.data.settings.kitchenOpen ? '厨师今天营业' : '厨师今天歇业'));
  },

  onOpenRules() {
    this.setData({ showRules: true });
  },

  onCloseRules() {
    this.setData({ showRules: false });
  },

  async onSwitchRole() {
    if (!this.data.isMock || this.data.mockBusy) return;
    const next = this.data.nextRole;
    this.setData({ mockBusy: 'switch' });
    try {
      const result = await api.call('switchRole', { role: next });
      const app = getApp();
      app.applyBoot(result);
      ui.success('现在是' + (next === 'chef' ? '厨师' : '食客'));
      wx.switchTab({ url: session.homePath(next) });
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.setData({ mockBusy: '' });
    }
  },

  async onSeedDemo() {
    if (!this.data.isMock || this.data.mockBusy) return;
    const ok = await ui.confirm({
      title: '载入演示数据？',
      content: '会生成一条已出餐的高分订单，和一条被打回的翻车记录。',
      confirmText: '载入'
    });
    if (!ok) return;
    this.setData({ mockBusy: 'seed' });
    try {
      const result = await api.call('seedDemo', {});
      const app = getApp();
      app.applyBoot(result);
      ui.success('演示数据已就位');
      await this.load(true);
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.setData({ mockBusy: '' });
    }
  },

  async onResetDemo() {
    if (!this.data.isMock || this.data.mockBusy) return;
    const ok = await ui.confirm({
      title: '清空演示数据？',
      content: '本机所有演示身份、订单和菜单都会删掉，需要重新开张。',
      confirmText: '清空'
    });
    if (!ok) return;
    this.setData({ mockBusy: 'reset' });
    try {
      const result = await api.call('resetDemo', {});
      const app = getApp();
      app.applyBoot(result);
      wx.reLaunch({ url: '/pages/setup/setup' });
    } catch (error) {
      ui.toastError(error);
      this.setData({ mockBusy: '' });
    }
  },

  onRetry() {
    this.load();
  }
});
