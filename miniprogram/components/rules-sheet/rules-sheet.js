'use strict';

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    role: {
      type: String,
      value: 'diner'
    }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    noop() {
      // 阻止点击内容区关闭
    }
  }
});
