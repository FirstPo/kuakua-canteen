'use strict';

const catalog = require('../../shared/catalog');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

Page({
  data: {
    loading: true,
    error: '',
    closed: false,
    availableRoles: [],
    selectedRole: '',
    chefTaken: false,
    dinerTaken: false,
    chefSelected: false,
    dinerSelected: false,
    nickname: '',
    emoji: '🍳',
    passScore: catalog.DEFAULT_PASS_SCORE,
    minLen: catalog.DEFAULT_MIN_LEN,
    emojiChoices: catalog.AVATAR_CHOICES,
    submitting: false
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const data = await session.refresh();
      if (data.access === 'ready') {
        session.toHome(data.role);
        return;
      }
      const roles = data.availableRoles || [];
      let selected = this.data.selectedRole;
      if (selected && roles.indexOf(selected) < 0) selected = '';
      if (!selected && roles.length === 1) selected = roles[0];
      const patch = {
        loading: false,
        closed: data.access === 'closed',
        availableRoles: roles,
        selectedRole: selected,
        chefTaken: roles.indexOf('chef') < 0,
        dinerTaken: roles.indexOf('diner') < 0,
        chefSelected: selected === 'chef',
        dinerSelected: selected === 'diner'
      };
      if (selected && !this.data.nickname) {
        patch.nickname = selected === 'chef' ? '大厨' : '小馋猫';
        patch.emoji = selected === 'chef' ? '🍳' : '🐰';
      }
      this.setData(patch);
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onSelectRole(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.availableRoles.indexOf(role) < 0) {
      ui.toast('这个位置已经有人了');
      return;
    }
    const defaults = role === 'chef'
      ? { nickname: '大厨', emoji: '🍳' }
      : { nickname: '小馋猫', emoji: '🐰' };
    const otherDefault = role === 'chef' ? '小馋猫' : '大厨';
    const keepName = this.data.nickname && this.data.nickname !== otherDefault
      ? this.data.nickname
      : defaults.nickname;
    this.setData({
      selectedRole: role,
      chefSelected: role === 'chef',
      dinerSelected: role === 'diner',
      nickname: keepName,
      emoji: defaults.emoji
    });
  },

  onNickname(event) {
    this.setData({ nickname: event.detail.value });
  },

  onEmoji(event) {
    this.setData({ emoji: event.currentTarget.dataset.emoji });
  },

  onPassScore(event) {
    this.setData({ passScore: event.detail.value });
  },

  onMinLen(event) {
    this.setData({ minLen: event.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const role = this.data.selectedRole;
    if (!role) {
      ui.toast('先选一个身份');
      return;
    }
    const nickname = String(this.data.nickname || '').trim();
    if (!nickname) {
      ui.toast('先起个称呼');
      return;
    }

    this.setData({ submitting: true });
    ui.loading('开张中');
    try {
      const payload = {
        role: role,
        nickname: nickname,
        emoji: this.data.emoji
      };
      if (role === 'chef') {
        payload.passScore = Number(this.data.passScore);
        payload.minLen = Number(this.data.minLen);
      }
      const data = await api.call('bindRole', payload);
      getApp().applyBoot(data);
      ui.hideLoading();
      ui.success('开张了');
      setTimeout(() => session.toHome(data.role), 280);
    } catch (error) {
      ui.hideLoading();
      ui.toastError(error);
      this.setData({ submitting: false });
      this.load();
    }
  },

  onRefresh() {
    this.load();
  },

  onShareAppMessage() {
    return {
      title: '来夸我，就有饭吃',
      path: '/pages/setup/setup'
    };
  }
});
