'use strict';

const { BREAKDOWN_META } = require('../../shared/praise-score');

Component({
  properties: {
    breakdown: {
      type: Object,
      value: {}
    },
    compact: {
      type: Boolean,
      value: false
    }
  },

  data: {
    bars: []
  },

  observers: {
    breakdown(value) {
      this.build(value);
    }
  },

  lifetimes: {
    attached() {
      this.build(this.data.breakdown);
    }
  },

  methods: {
    build(value) {
      const source = value || {};
      const bars = BREAKDOWN_META.map(item => {
        const raw = Number(source[item.key]) || 0;
        const score = Math.max(0, Math.min(item.max, raw));
        return {
          key: item.key,
          label: item.label,
          max: item.max,
          value: score,
          percent: Math.round((score / item.max) * 100)
        };
      });
      this.setData({ bars: bars });
    }
  }
});
