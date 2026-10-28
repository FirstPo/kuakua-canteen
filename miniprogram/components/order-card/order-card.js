'use strict';

const fmt = require('../../shared/format');
const status = require('../../shared/order-status');

Component({
  properties: {
    order: {
      type: Object,
      value: null
    },
    role: {
      type: String,
      value: 'diner'
    }
  },

  data: {
    priceText: '',
    timeText: '',
    dishText: '',
    copy: '',
    actionText: ''
  },

  observers: {
    'order, role'(order, role) {
      this.refresh(order, role);
    }
  },

  methods: {
    refresh(order, role) {
      if (!order) {
        this.setData({ priceText: '', timeText: '', dishText: '', copy: '', actionText: '' });
        return;
      }
      const items = order.items || [];
      const names = items.slice(0, 3).map(item => item.name + (item.custom ? '（自点）' : '') + '×' + item.qty);
      if (items.length > 3) names.push('等 ' + items.length + ' 道');
      const actions = status.actionsFor(order, role || 'diner');
      this.setData({
        priceText: fmt.formatMoney(order.totalCents),
        timeText: fmt.relativeTime(order.createdAt),
        dishText: names.join('、'),
        copy: status.statusCopy(order.status, role || 'diner'),
        actionText: actions.length ? status.actionMeta(actions[0]).label : ''
      });
    },

    onTap() {
      const order = this.data.order;
      if (!order) return;
      this.triggerEvent('tap', { id: order._id });
    }
  }
});
