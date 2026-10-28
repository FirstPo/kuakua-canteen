'use strict';

const TABS = [
  { key: 'home', text: '食堂', icon: '🍜', roles: ['diner'] },
  { key: 'kitchen', text: '厨房', icon: '🍳', roles: ['chef'] },
  { key: 'orders', text: '订单', icon: '🧾', roles: ['chef', 'diner'] },
  { key: 'praise-wall', text: '夸夸', icon: '💌', roles: ['chef', 'diner'] },
  { key: 'me', text: '我的', icon: '🧑‍🍳', roles: ['chef', 'diner'] }
];

const PATHS = {
  home: '/pages/home/home',
  kitchen: '/pages/kitchen/kitchen',
  orders: '/pages/orders/orders',
  'praise-wall': '/pages/praise-wall/praise-wall',
  me: '/pages/me/me'
};

Component({
  data: {
    role: 'diner',
    selectedKey: 'home',
    hidden: false,
    tabs: []
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const app = getApp();
      const role = app && app.globalData ? (app.globalData.role || 'diner') : 'diner';
      const tabs = TABS.filter(tab => tab.roles.indexOf(role) >= 0);
      this.setData({ role: role, tabs: tabs });
    },

    onTap(event) {
      const key = event.currentTarget.dataset.key;
      if (!key || !PATHS[key] || key === this.data.selectedKey) return;
      wx.switchTab({ url: PATHS[key] });
    }
  }
});
