'use strict';

function toast(title) {
  wx.showToast({
    title: title || '好的',
    icon: 'none',
    duration: 2200
  });
}

function success(title) {
  wx.showToast({
    title: title || '好了',
    icon: 'success',
    duration: 1600
  });
}

function loading(title) {
  wx.showLoading({
    title: title || '稍等',
    mask: true
  });
}

function hideLoading() {
  try {
    wx.hideLoading();
  } catch (error) {
    // 没有 loading 时 hide 会报错，忽略。
  }
}

function confirm(options) {
  const opts = options || {};
  return new Promise(resolve => {
    wx.showModal({
      title: opts.title || '确认一下',
      content: opts.content || '',
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '算了',
      confirmColor: opts.confirmColor || '#D94F2B',
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    });
  });
}

function alert(title, content) {
  return new Promise(resolve => {
    wx.showModal({
      title: title || '提示',
      content: content || '',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#D94F2B',
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function copy(text, tip) {
  wx.setClipboardData({
    data: String(text == null ? '' : text),
    success: () => {
      if (tip) toast(tip);
    }
  });
}

function errorMessage(error) {
  if (!error) return '出错了，再试一次';
  if (error.code === 'NETWORK') return error.message || '网络不给力';
  if (error.code === 'ACTIVE_ORDER') return error.message || '上一单还没结束';
  if (error.code === 'KITCHEN_CLOSED') return error.message || '厨师今天歇业';
  if (error.code === 'CONFLICT') return '订单刚刚变过，刷新看看';
  if (error.code === 'INVALID_STATUS') return error.message || '这一步现在做不了';
  return error.message || '出错了，再试一次';
}

function toastError(error) {
  toast(errorMessage(error));
}

module.exports = {
  toast: toast,
  success: success,
  loading: loading,
  hideLoading: hideLoading,
  confirm: confirm,
  alert: alert,
  copy: copy,
  errorMessage: errorMessage,
  toastError: toastError
};
