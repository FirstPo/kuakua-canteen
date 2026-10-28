'use strict';

const catalog = require('../../shared/catalog');
const customDish = require('../../shared/custom-dish');
const fmt = require('../../shared/format');
const status = require('../../shared/order-status');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');
const cart = require('../../utils/cart');

function customView(map, customMap) {
  return Object.keys(map)
    .filter(id => customDish.isCustomId(id) && customMap[id] && map[id] > 0)
    .map(id => {
      const custom = customMap[id];
      return {
        id: id,
        dishId: id,
        qty: map[id],
        name: custom.name,
        desc: custom.desc || '',
        emoji: custom.emoji,
        priceCents: custom.priceCents,
        priceText: fmt.formatMoney(custom.priceCents)
      };
    });
}

function activeView(order, role) {
  if (!order) return null;
  let action = '去看看';
  if (order.status === status.STATUS.REJECTED) action = '去重夸';
  else if (order.status === status.STATUS.APPROVED) action = '去付菜钱';
  else if (order.status === status.STATUS.PAYMENT_CLAIMED) action = '等厨师确认';
  else if (order.status === status.STATUS.PAID) action = '等开火';
  else if (order.status === status.STATUS.COOKING) action = '锅里正热闹';
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
    copy: status.statusCopy(order.status, role || 'diner'),
    action: action
  };
}

Page({
  data: {
    loading: true,
    error: '',
    role: 'diner',
    user: null,
    partner: null,
    settings: null,
    kitchenOpen: true,
    kitchenNote: '',
    activeOrder: null,
    categories: ['全部'].concat(catalog.CATEGORIES),
    activeCategory: '全部',
    dishes: [],
    customItems: [],
    hasCustom: false,
    passScore: catalog.DEFAULT_PASS_SCORE,
    minLen: catalog.DEFAULT_MIN_LEN,
    customPassScore: catalog.DEFAULT_PASS_SCORE + catalog.CUSTOM_PASS_BONUS,
    customMinLen: catalog.DEFAULT_MIN_LEN + catalog.CUSTOM_MIN_LEN_BONUS,
    cartCount: 0,
    cartTotalText: '¥0',
    canCheckout: false,
    maxCustomName: catalog.MAX_DISH_NAME_LEN,
    maxCustomDesc: catalog.MAX_DISH_DESC_LEN,
    emojis: catalog.EMOJI_CHOICES,
    customForm: {
      show: false,
      name: '',
      desc: '',
      emoji: '🍲',
      priceInput: '',
      submitting: false
    }
  },

  onShow() {
    this.syncTab();
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  syncTab() {
    if (typeof this.getTabBar !== 'function') return;
    const tabBar = this.getTabBar();
    if (tabBar) {
      tabBar.setData({
        selectedKey: 'home',
        role: getApp().globalData.role || 'diner',
        hidden: false
      });
    }
  },

  setTabBarHidden(hidden) {
    if (typeof this.getTabBar !== 'function') return;
    const tabBar = this.getTabBar();
    if (tabBar) tabBar.setData({ hidden: !!hidden });
  },

  async load() {
    try {
      const boot = await session.requireReady('diner');
      if (!boot) return;
      const menuResult = await api.call('getMenu', {});
      const map = cart.load();
      const customMap = cart.loadCustom();
      const available = {};
      menuResult.dishes.forEach(dish => {
        if (dish.available) available[dish._id] = true;
        else delete map[dish._id];
      });
      Object.keys(map).forEach(id => {
        if (customDish.isCustomId(id)) {
          if (!customMap[id]) delete map[id];
          return;
        }
        if (!available[id]) delete map[id];
      });
      cart.save(map);

      const dishes = menuResult.dishes.map(dish => Object.assign({}, dish, {
        qty: map[dish._id] || 0,
        priceText: fmt.formatMoney(dish.priceCents)
      }));
      const customItems = customView(map, customMap);
      const view = activeView(boot.activeOrder, boot.role);
      this.setData({
        loading: false,
        error: '',
        role: boot.role,
        user: boot.user,
        partner: boot.partner,
        settings: boot.settings,
        kitchenOpen: boot.settings.kitchenOpen,
        kitchenNote: boot.settings.kitchenNote,
        activeOrder: view,
        dishes: dishes,
        customItems: customItems,
        customPassScore: customDish.thresholdsFor(boot.settings, true).passScore,
        customMinLen: customDish.thresholdsFor(boot.settings, true).minLen
      });
      this.refreshCart(dishes, map, boot.settings.kitchenOpen, view, customItems);
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  refreshCart(dishes, map, kitchenOpen, activeOrder, customList) {
    const list = dishes || this.data.dishes;
    const currentMap = map || cart.load();
    const active = activeOrder !== undefined ? activeOrder : this.data.activeOrder;
    const customMap = cart.loadCustom();
    const customItems = customList || customView(currentMap, customMap);
    const count = cart.count(currentMap);
    const totalCents = cart.totalCents(currentMap, list, customMap);
    const hasCustom = customItems.length > 0;
    const thresholds = customDish.thresholdsFor(this.data.settings, hasCustom);
    const customThresholds = customDish.thresholdsFor(this.data.settings, true);
    const nextDishes = list.map(dish => Object.assign({}, dish, {
      qty: currentMap[dish._id] || 0
    }));
    this.setData({
      dishes: nextDishes,
      customItems: customItems,
      hasCustom: hasCustom,
      passScore: thresholds.passScore,
      minLen: thresholds.minLen,
      customPassScore: customThresholds.passScore,
      customMinLen: customThresholds.minLen,
      cartCount: count,
      cartTotalText: fmt.formatMoney(totalCents),
      canCheckout: count > 0 && !active && (kitchenOpen !== false)
    });
  },

  onCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.category });
  },

  onAdd(event) {
    const id = event.currentTarget.dataset.id;
    if (customDish.isCustomId(id)) {
      const custom = this.data.customItems.find(item => item.id === id);
      if (!custom) {
        ui.toast('这道自点菜不在购物车里了');
        return;
      }
      const map = cart.load();
      const qty = Math.min(catalog.MAX_QTY, (map[id] || 0) + 1);
      cart.setQty(id, qty);
      this.refreshCart(this.data.dishes, cart.load(), this.data.kitchenOpen, this.data.activeOrder);
      return;
    }
    const dish = this.data.dishes.find(item => item._id === id);
    if (!dish || !dish.available) {
      ui.toast('这道菜现在点不了');
      return;
    }
    const map = cart.load();
    const qty = Math.min(catalog.MAX_QTY, (map[id] || 0) + 1);
    cart.setQty(id, qty);
    this.refreshCart(this.data.dishes, cart.load(), this.data.kitchenOpen, this.data.activeOrder);
  },

  onMinus(event) {
    const id = event.currentTarget.dataset.id;
    const map = cart.load();
    const qty = Math.max(0, (map[id] || 0) - 1);
    cart.setQty(id, qty);
    this.refreshCart(this.data.dishes, cart.load(), this.data.kitchenOpen, this.data.activeOrder);
  },

  onCheckout() {
    if (this.data.activeOrder) {
      this.openOrder(this.data.activeOrder._id);
      return;
    }
    if (!this.data.kitchenOpen) {
      ui.toast('厨师今天歇业，看看公告');
      return;
    }
    if (!this.data.cartCount) {
      ui.toast('先点一道菜');
      return;
    }
    wx.navigateTo({ url: '/pages/praise/praise' });
  },

  onOpenCustom() {
    if (this.data.activeOrder) {
      ui.toast('先把上一单走完');
      return;
    }
    if (!this.data.kitchenOpen) {
      ui.toast('厨师今天歇业');
      return;
    }
    this.setData({
      customForm: {
        show: true,
        name: '',
        desc: '',
        emoji: '🍲',
        priceInput: '',
        submitting: false
      }
    });
    this.setTabBarHidden(true);
  },

  onCloseCustom() {
    if (this.data.customForm.submitting) return;
    this.setData({ 'customForm.show': false });
    this.setTabBarHidden(false);
  },

  onHide() {
    if (this.data.customForm.show) {
      this.setData({ 'customForm.show': false });
      this.setTabBarHidden(false);
    }
  },

  noop() {
    // 阻止点击弹层内容时关闭弹层。
  },

  onCustomInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ ['customForm.' + field]: event.detail.value });
  },

  onCustomEmoji(event) {
    this.setData({ 'customForm.emoji': event.currentTarget.dataset.emoji });
  },

  onCustomSubmit() {
    if (this.data.customForm.submitting) return;
    const form = this.data.customForm;
    const name = String(form.name || '').trim();
    if (!name) {
      ui.toast('先给这道菜起个名');
      return;
    }
    if (Array.from(name).length > catalog.MAX_DISH_NAME_LEN) {
      ui.toast('菜名最多 ' + catalog.MAX_DISH_NAME_LEN + ' 个字');
      return;
    }
    const priceCents = fmt.yuanToCents(form.priceInput);
    if (priceCents == null || priceCents < catalog.MIN_CUSTOM_PRICE_CENTS) {
      ui.toast('价格写成 25 或 25.5 这样，至少 1 元');
      return;
    }
    if (Object.keys(cart.load()).length >= catalog.MAX_ITEMS) {
      ui.toast('一次最多点 ' + catalog.MAX_ITEMS + ' 道菜');
      return;
    }
    this.setData({ 'customForm.submitting': true });
    const id = cart.addCustom({
      name: name,
      desc: String(form.desc || '').trim(),
      emoji: form.emoji,
      priceCents: priceCents
    });
    if (!id) {
      this.setData({ 'customForm.submitting': false });
      ui.toast('这道菜没加进去，再试一次');
      return;
    }
    this.setData({
      'customForm.show': false,
      'customForm.submitting': false
    });
    this.setTabBarHidden(false);
    this.refreshCart(this.data.dishes, cart.load(), this.data.kitchenOpen, this.data.activeOrder);
    ui.success('已加进购物车');
  },

  onActiveTap() {
    if (this.data.activeOrder) this.openOrder(this.data.activeOrder._id);
  },

  onOrderTap(event) {
    this.openOrder(event.currentTarget.dataset.id);
  },

  openOrder(id) {
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?orderId=' + id });
  },

  onShareAppMessage() {
    return {
      title: '来夸我，就有饭吃',
      path: '/pages/home/home'
    };
  }
});
