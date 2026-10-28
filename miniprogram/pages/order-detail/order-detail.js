'use strict';

const fmt = require('../../shared/format');
const status = require('../../shared/order-status');
const { HARD_FAIL_LABELS, effectiveLength } = require('../../shared/praise-score');
const api = require('../../services/api');
const session = require('../../utils/session');
const ui = require('../../utils/ui');

const API_ACTION = {
  cancel: 'cancelOrder',
  claim: 'claimPayment',
  chefApprove: 'chefApprove',
  chefReject: 'chefReject',
  confirmPayment: 'confirmPayment',
  rejectPaymentClaim: 'rejectPaymentClaim',
  startCooking: 'startCooking',
  finishCooking: 'finishCooking',
  nudge: 'nudge'
};

const SUCCESS_TEXT = {
  cancel: '订单已取消',
  claim: '已报备转账',
  chefApprove: '已破格通过',
  chefReject: '已打回，等她重夸',
  confirmPayment: '收款确认',
  rejectPaymentClaim: '已退回待付款',
  startCooking: '开火',
  finishCooking: '出锅',
  nudge: '已经催了'
};

const SHEET_CONFIG = {
  chefReject: {
    title: '打回重夸',
    hint: '可以留句话，让她知道差在哪；不写就默认「还不够走心」。',
    confirmText: '打回',
    showReason: true,
    showDemand: true,
    reasonPlaceholder: '批语，比如：像从网上抄的',
    demandPlaceholder: '点名要求，比如：夸夸我颠勺的样子'
  },
  chefApprove: {
    title: '破格准了',
    hint: '她没到满意线，但你说了算。',
    confirmText: '准了',
    showReason: true,
    reasonPlaceholder: '批语（可不填）'
  },
  claim: {
    title: '我已转账',
    hint: '确认已经在微信里把菜钱转给厨师，再点下面。',
    confirmText: '报备转账',
    showNote: true,
    notePlaceholder: '转账备注（可不填）'
  },
  rejectPaymentClaim: {
    title: '没收到转账',
    hint: '退回后订单会回到待付款，她可以重新报备。',
    confirmText: '确认没收到',
    showReason: true,
    reasonPlaceholder: '说明（可不填）'
  }
};

const PAY_STATUS = {
  approved: '待付款',
  payment_claimed: '待确认收款',
  paid: '已收款',
  cooking: '已收款',
  served: '已收款'
};

function buildTimeline(order) {
  const list = [{
    key: 'created',
    label: '下单',
    desc: '提交第一轮夸奖',
    state: 'done'
  }];
  if (order.status === status.STATUS.REJECTED) {
    list.push({
      key: 'praise',
      label: '重夸',
      desc: '等下一轮夸奖',
      state: 'current'
    });
  } else if (order.status === status.STATUS.CANCELLED) {
    list.push({
      key: 'cancelled',
      label: '取消',
      desc: '这一单散了',
      state: 'current'
    });
  } else {
    status.timelineFor(order.status).forEach(step => list.push(step));
  }
  return list;
}

function payHint(order, role) {
  if (order.status === status.STATUS.APPROVED) {
    return role === 'chef'
      ? '等她微信转账，到账后点「确认收款」。'
      : '微信转账给厨师，然后点「我已转账」。';
  }
  if (order.status === status.STATUS.PAYMENT_CLAIMED) {
    return role === 'chef'
      ? '她说已经转了，核对一下再确认。'
      : '已经报备，等厨师核对。';
  }
  return '菜钱已收，专心做饭。';
}

Page({
  data: {
    loading: true,
    error: '',
    orderId: '',
    role: 'diner',
    order: null,
    items: [],
    totalText: '¥0',
    statusLabel: '',
    statusCopy: '',
    timeline: [],
    rounds: [],
    actions: [],
    showPayment: false,
    showNotPaid: false,
    payStatusLabel: '',
    payHint: '',
    payment: null,
    paymentClaimedText: '',
    paymentConfirmedText: '',
    paymentRejectReason: '',
    paymentNote: '',
    copyText: '',
    createdText: '',
    updatedText: '',
    note: '',
    nudgeCount: 0,
    busy: false,
    sheet: {
      show: false,
      action: '',
      title: '',
      hint: '',
      confirmText: '',
      reason: '',
      demand: '',
      note: '',
      showReason: false,
      showDemand: false,
      showNote: false,
      reasonPlaceholder: '',
      demandPlaceholder: '',
      notePlaceholder: '',
      submitting: false
    }
  },

  onLoad(options) {
    this.orderId = (options && options.orderId) || '';
    this.setData({ orderId: this.orderId });
    this.load();
  },

  onShow() {
    if (this.loadedOnce) this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  async load(silent) {
    if (!this.orderId) {
      this.setData({ loading: false, error: '缺少订单号' });
      return;
    }
    if (!silent) this.setData({ loading: true, error: '' });
    try {
      const boot = await session.requireReady();
      if (!boot) return;
      const detail = await api.call('getOrder', { orderId: this.orderId });
      const order = detail.order;
      const rounds = (order.praiseRounds || []).map((round, index, list) => ({
        round: round.round,
        score: round.score,
        text: round.text,
        topic: round.topic || '',
        verdict: round.verdict,
        reviewedBy: round.reviewedBy,
        verdictLabel: status.roundVerdictLabel(round.verdict, round.reviewedBy),
        breakdown: round.breakdown || {},
        hardFailTexts: (round.hardFail || []).map(key => HARD_FAIL_LABELS[key] || key),
        suggestions: round.suggestions || [],
        reason: round.reason || '',
        demand: round.demand || '',
        timeText: fmt.formatTime(round.createdAt),
        effLen: effectiveLength(round.text),
        isLatest: index === list.length - 1
      }));
      const payment = order.payment || {};
      const actions = (detail.actions || []).map(key => {
        const meta = status.actionMeta(key);
        return { key: key, label: meta.label, style: meta.style };
      });
      const showPayment = !!PAY_STATUS[order.status];
      const totalText = fmt.formatMoney(order.totalCents);

      this.setData({
        loading: false,
        error: '',
        role: detail.role,
        order: order,
        items: (order.items || []).map(item => Object.assign({}, item, {
          priceText: fmt.formatMoney(item.lineTotalCents)
        })),
        totalText: totalText,
        statusLabel: status.statusLabel(order.status),
        statusCopy: status.statusCopy(order.status, detail.role),
        timeline: buildTimeline(order),
        rounds: rounds,
        actions: actions,
        showPayment: showPayment,
        showNotPaid: order.status === status.STATUS.REJECTED,
        payStatusLabel: PAY_STATUS[order.status] || '',
        payHint: showPayment ? payHint(order, detail.role) : '',
        payment: payment,
        paymentClaimedText: payment.claimedAt ? fmt.formatTime(payment.claimedAt) : '',
        paymentConfirmedText: payment.confirmedAt ? fmt.formatTime(payment.confirmedAt) : '',
        paymentRejectReason: payment.rejectReason || '',
        paymentNote: payment.note || '',
        copyText: '夸夸食堂 ' + order.orderNo + ' 菜钱 ' + totalText,
        createdText: fmt.formatTime(order.createdAt),
        updatedText: fmt.formatTime(order.updatedAt),
        note: order.note || '',
        nudgeCount: order.nudgeCount || 0
      });
      this.loadedOnce = true;
    } catch (error) {
      this.setData({ loading: false, error: ui.errorMessage(error) });
    }
  },

  onAction(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    if (key === 'repraise') {
      wx.redirectTo({
        url: '/pages/praise/praise?orderId=' + this.orderId
      });
      return;
    }
    if (key === 'reorder') {
      wx.switchTab({ url: '/pages/home/home' });
      return;
    }
    if (key === 'nudge') {
      this.doNudge();
      return;
    }
    if (SHEET_CONFIG[key]) {
      this.openSheet(key);
      return;
    }
    if (key === 'confirmPayment' || key === 'startCooking' ||
        key === 'finishCooking' || key === 'cancel') {
      this.confirmAndRun(key);
    }
  },

  openSheet(key) {
    const config = SHEET_CONFIG[key];
    if (!config) return;
    this.setData({
      'sheet.show': true,
      'sheet.action': key,
      'sheet.title': config.title,
      'sheet.hint': config.hint,
      'sheet.confirmText': config.confirmText,
      'sheet.reason': '',
      'sheet.demand': '',
      'sheet.note': '',
      'sheet.showReason': !!config.showReason,
      'sheet.showDemand': !!config.showDemand,
      'sheet.showNote': !!config.showNote,
      'sheet.reasonPlaceholder': config.reasonPlaceholder || '',
      'sheet.demandPlaceholder': config.demandPlaceholder || '',
      'sheet.notePlaceholder': config.notePlaceholder || '',
      'sheet.submitting': false
    });
  },

  onSheetInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ ['sheet.' + field]: event.detail.value });
  },

  onSheetClose() {
    if (this.data.sheet.submitting) return;
    this.setData({ 'sheet.show': false });
  },

  noop() {
    // 阻止点击内容区时冒泡关闭。
  },

  onSheetSubmit() {
    const sheet = this.data.sheet;
    if (!sheet.action || sheet.submitting) return;
    const payload = { orderId: this.orderId };
    if (sheet.showReason) payload.reason = sheet.reason;
    if (sheet.showDemand) payload.demand = sheet.demand;
    if (sheet.showNote) payload.note = sheet.note;
    this.setData({ 'sheet.submitting': true });
    this.runAction(API_ACTION[sheet.action], payload, SUCCESS_TEXT[sheet.action], true);
  },

  async confirmAndRun(key) {
    if (this.busy) return;
    let content = '';
    let confirmText = '确定';
    if (key === 'confirmPayment') {
      const note = this.data.paymentNote ? '，她备注：' + this.data.paymentNote : '';
      content = '确认收到 ' + this.data.totalText + ' 菜钱' + note + '？';
      confirmText = '确认收款';
    } else if (key === 'startCooking') {
      content = '钱已到账，现在开火？';
      confirmText = '开火';
    } else if (key === 'finishCooking') {
      content = '菜好了，这单就完成了。';
      confirmText = '出锅';
    } else if (key === 'cancel') {
      content = '取消后这一单就散了，确定吗？';
      confirmText = '取消订单';
    }
    const ok = await ui.confirm({
      title: '确认一下',
      content: content,
      confirmText: confirmText
    });
    if (!ok) return;
    await this.runAction(API_ACTION[key], { orderId: this.orderId }, SUCCESS_TEXT[key]);
  },

  async doNudge() {
    if (this.busy) return;
    this.busy = true;
    try {
      await api.call('nudge', { orderId: this.orderId });
      ui.toast('轻轻催了一下');
      await this.load(true);
    } catch (error) {
      ui.toastError(error);
    } finally {
      this.busy = false;
    }
  },

  async runAction(action, payload, successText, fromSheet) {
    if (this.busy) return;
    this.busy = true;
    ui.loading('处理中');
    try {
      await api.call(action, payload || {});
      ui.hideLoading();
      ui.success(successText || '好了');
      this.setData({
        'sheet.show': false,
        'sheet.submitting': false
      });
      await this.load(true);
    } catch (error) {
      ui.hideLoading();
      if (fromSheet) this.setData({ 'sheet.submitting': false });
      ui.toastError(error);
      if (error.code === 'CONFLICT' || error.code === 'INVALID_STATUS') {
        this.setData({ 'sheet.show': false });
        await this.load(true);
      }
    } finally {
      this.busy = false;
    }
  },

  onCopyPay() {
    ui.copy(this.data.copyText, '收款信息已复制');
  },

  onCopyOrderNo() {
    ui.copy((this.data.order && this.data.order.orderNo) || '', '订单号已复制');
  },

  onRetry() {
    this.load();
  }
});
