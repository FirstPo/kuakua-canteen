'use strict';

const STATUS = {
  REJECTED: 'rejected',
  APPROVED: 'approved',
  PAYMENT_CLAIMED: 'payment_claimed',
  PAID: 'paid',
  COOKING: 'cooking',
  SERVED: 'served',
  CANCELLED: 'cancelled'
};

const ACTIVE = [
  STATUS.REJECTED,
  STATUS.APPROVED,
  STATUS.PAYMENT_CLAIMED,
  STATUS.PAID,
  STATUS.COOKING
];

const LABELS = {
  rejected: '重夸中',
  approved: '待付款',
  payment_claimed: '待确认',
  paid: '已收款',
  cooking: '烹饪中',
  served: '已出餐',
  cancelled: '已取消'
};

const COPIES = {
  rejected: {
    diner: '厨师摇了摇头：这夸得还不够。',
    chef: '她还在憋下一轮夸奖。'
  },
  approved: {
    diner: '龙颜大悦，准了。先去交菜钱。',
    chef: '夸到位了，等她转账。'
  },
  payment_claimed: {
    diner: '转账已报备，等厨师核对。',
    chef: '她说转了，核对一下。'
  },
  paid: {
    diner: '钱收到了，厨师正在系围裙。',
    chef: '钱到了，可以开火。'
  },
  cooking: {
    diner: '灶上正热闹，别催。',
    chef: '锅气上来了，稳住。'
  },
  served: {
    diner: '出锅了，趁热吃。',
    chef: '出餐，等她夸第二顿。'
  },
  cancelled: {
    diner: '这单散了。',
    chef: '这单散了。'
  }
};

const TIMELINE = [
  { key: 'approved', label: '过线', desc: '夸奖过线' },
  { key: 'payment_claimed', label: '转账', desc: '她点已转账' },
  { key: 'paid', label: '收款', desc: '你确认收款' },
  { key: 'cooking', label: '开火', desc: '开始做饭' },
  { key: 'served', label: '出餐', desc: '完成' }
];

const ACTION_META = {
  repraise: { label: '重新夸', style: 'primary' },
  cancel: { label: '取消订单', style: 'ghost' },
  claim: { label: '我已转账', style: 'primary' },
  chefReject: { label: '打回重夸', style: 'danger' },
  chefApprove: { label: '破格准了', style: 'primary' },
  confirmPayment: { label: '确认收款', style: 'primary' },
  rejectPaymentClaim: { label: '没收到', style: 'danger' },
  startCooking: { label: '开火', style: 'primary' },
  finishCooking: { label: '出锅', style: 'primary' },
  nudge: { label: '催一催', style: 'ghost' },
  reorder: { label: '再点一单', style: 'primary' }
};

function isActive(status) {
  return ACTIVE.indexOf(status) >= 0;
}

function statusLabel(status) {
  return LABELS[status] || '未知';
}

function statusCopy(status, role) {
  const item = COPIES[status];
  if (!item) return '';
  return role === 'chef' ? item.chef : item.diner;
}

function statusMeta(status, role) {
  return {
    key: status,
    label: statusLabel(status),
    copy: statusCopy(status, role),
    active: isActive(status)
  };
}

function canRepraise(status) {
  return status === STATUS.REJECTED;
}

function canCancel(status) {
  return status === STATUS.REJECTED || status === STATUS.APPROVED;
}

function canChefApprove(status) {
  return status === STATUS.REJECTED;
}

function canChefReject(status) {
  return status === STATUS.APPROVED;
}

function canClaim(status) {
  return status === STATUS.APPROVED;
}

function canConfirm(status) {
  return status === STATUS.PAYMENT_CLAIMED;
}

function canRejectClaim(status) {
  return status === STATUS.PAYMENT_CLAIMED;
}

function canStart(status) {
  return status === STATUS.PAID;
}

function canFinish(status) {
  return status === STATUS.COOKING;
}

function canNudge(status) {
  return status === STATUS.PAYMENT_CLAIMED ||
    status === STATUS.PAID ||
    status === STATUS.COOKING;
}

function actionsFor(order, role) {
  if (!order || !order.status) return [];
  const s = order.status;
  if (role === 'chef') {
    if (s === STATUS.REJECTED) return ['chefApprove', 'cancel'];
    if (s === STATUS.APPROVED) return ['chefReject', 'cancel'];
    if (s === STATUS.PAYMENT_CLAIMED) return ['confirmPayment', 'rejectPaymentClaim'];
    if (s === STATUS.PAID) return ['startCooking'];
    if (s === STATUS.COOKING) return ['finishCooking'];
    return [];
  }
  if (role === 'diner') {
    if (s === STATUS.REJECTED) return ['repraise', 'cancel'];
    if (s === STATUS.APPROVED) return ['claim', 'cancel'];
    if (s === STATUS.PAYMENT_CLAIMED) return ['nudge'];
    if (s === STATUS.PAID || s === STATUS.COOKING) return ['nudge'];
    if (s === STATUS.SERVED || s === STATUS.CANCELLED) return ['reorder'];
    return [];
  }
  return [];
}

function actionMeta(key) {
  return ACTION_META[key] || { label: key, style: 'ghost' };
}

const STATUS_INDEX = {
  rejected: -1,
  approved: 0,
  payment_claimed: 1,
  paid: 2,
  cooking: 3,
  served: 4,
  cancelled: -2
};

function timelineFor(status) {
  const idx = STATUS_INDEX[status];
  if (idx == null || idx < 0) return [];
  const finished = status === STATUS.SERVED;
  return TIMELINE.map((step, i) => ({
    key: step.key,
    label: step.label,
    desc: step.desc,
    state: finished || i < idx ? 'done' : (i === idx ? 'current' : 'pending')
  }));
}

function roundVerdictLabel(verdict, reviewedBy) {
  if (verdict === 'approved') {
    return reviewedBy === 'chef' ? '破格通过' : '过线';
  }
  if (verdict === 'rejected') {
    return reviewedBy === 'chef' ? '厨师打回' : '未过线';
  }
  return '待定';
}

module.exports = {
  STATUS,
  ACTIVE,
  LABELS,
  TIMELINE,
  ACTION_META,
  isActive,
  statusLabel,
  statusCopy,
  statusMeta,
  canRepraise,
  canCancel,
  canChefApprove,
  canChefReject,
  canClaim,
  canConfirm,
  canRejectClaim,
  canStart,
  canFinish,
  canNudge,
  actionsFor,
  actionMeta,
  timelineFor,
  roundVerdictLabel
};
