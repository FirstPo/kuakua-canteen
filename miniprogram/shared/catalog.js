'use strict';

const CATEGORIES = ['招牌', '家常', '主食', '汤饮', '甜点'];

const DEFAULT_PASS_SCORE = 80;
const DEFAULT_MIN_LEN = 20;

const MAX_PRAISE_LEN = 500;
const MAX_NOTE_LEN = 60;
const MAX_NICKNAME_LEN = 12;
const MAX_DISH_NAME_LEN = 16;
const MAX_DISH_DESC_LEN = 40;
const MAX_PRICE_CENTS = 99900;
const MAX_QTY = 20;
const MAX_ITEMS = 20;
const MAX_REASON_LEN = 60;
const MAX_DEMAND_LEN = 80;

// 菜单外自点菜：夸夸门槛整体加严，价格由食客先出，厨师可打回。
const CUSTOM_ITEM_PREFIX = 'custom_';
const CUSTOM_PASS_BONUS = 8;
const CUSTOM_MIN_LEN_BONUS = 10;
const MIN_CUSTOM_PRICE_CENTS = 100;
const MAX_CUSTOM_MIN_LEN = 60;

const EMOJI_CHOICES = [
  '🍜', '🍅', '🍗', '🌶️', '🫑', '🍝', '🥣', '🍚', '🥒', '🍧',
  '🥟', '🍲', '🍛', '🍤', '🥩', '🥬', '🍳', '🥚', '🧄', '🥕',
  '🌽', '🍄', '🥔', '🍞', '🍰', '🍮', '🍵', '🥤', '🍉', '🍓'
];

const AVATAR_CHOICES = [
  '🍳', '👨‍🍳', '🧑‍🍳', '🍚', '🐰', '🐱', '🐻', '🦊',
  '🌻', '🍊', '🍑', '🌙', '⭐', '🍀', '🐼', '🐯'
];

const PRAISE_PROMPTS = [
  '夸一个具体动作：刀工、火候、颠勺、收汁。',
  '提一道你今天点的菜，说说它哪里好吃。',
  '说一件他为你做饭的小事。',
  '夸夸他系围裙、买菜或洗碗的样子。',
  '用一个比喻形容他的手艺。',
  '说说你第一次吃他做的饭是什么感觉。',
  '夸完记得说谢谢，他吃这一套。',
  '别说「厉害」，说说为什么是他做的饭。',
  '用一句只有你们俩懂的话夸他。',
  '夸夸他记得你爱吃什么。',
  '说说这顿饭让你想起了什么。',
  '认真告诉他：这顿饭对你意味着什么。'
];

const SEED_DISHES = [
  {
    name: '油泼面',
    desc: '宽面现擀，辣子现泼，香得很。',
    emoji: '🍜',
    priceCents: 1200,
    category: '招牌',
    sort: 1
  },
  {
    name: '西红柿炒蛋',
    desc: '酸甜口，拌饭一绝。',
    emoji: '🍅',
    priceCents: 800,
    category: '家常',
    sort: 2
  },
  {
    name: '可乐鸡翅',
    desc: '收汁到发亮，甜咸打架。',
    emoji: '🍗',
    priceCents: 1800,
    category: '招牌',
    sort: 3
  },
  {
    name: '麻婆豆腐',
    desc: '麻、辣、烫，三样都占。',
    emoji: '🌶️',
    priceCents: 1000,
    category: '家常',
    sort: 4
  },
  {
    name: '青椒肉丝',
    desc: '肉丝上浆，青椒断生。',
    emoji: '🫑',
    priceCents: 1400,
    category: '家常',
    sort: 5
  },
  {
    name: '手擀面',
    desc: '面要擀得薄，切得匀。',
    emoji: '🍝',
    priceCents: 900,
    category: '主食',
    sort: 6
  },
  {
    name: '紫菜蛋花汤',
    desc: '饭前一碗，胃里舒坦。',
    emoji: '🥣',
    priceCents: 500,
    category: '汤饮',
    sort: 7
  },
  {
    name: '米饭',
    desc: '新米，管够。',
    emoji: '🍚',
    priceCents: 200,
    category: '主食',
    sort: 8
  },
  {
    name: '拍黄瓜',
    desc: '蒜多醋香，解腻。',
    emoji: '🥒',
    priceCents: 600,
    category: '家常',
    sort: 9
  },
  {
    name: '冰粉',
    desc: '红糖水，夏天续命。',
    emoji: '🍧',
    priceCents: 700,
    category: '甜点',
    sort: 10
  }
];

module.exports = {
  CATEGORIES,
  DEFAULT_PASS_SCORE,
  DEFAULT_MIN_LEN,
  MAX_PRAISE_LEN,
  MAX_NOTE_LEN,
  MAX_NICKNAME_LEN,
  MAX_DISH_NAME_LEN,
  MAX_DISH_DESC_LEN,
  MAX_PRICE_CENTS,
  MAX_QTY,
  MAX_ITEMS,
  MAX_REASON_LEN,
  MAX_DEMAND_LEN,
  CUSTOM_ITEM_PREFIX,
  CUSTOM_PASS_BONUS,
  CUSTOM_MIN_LEN_BONUS,
  MIN_CUSTOM_PRICE_CENTS,
  MAX_CUSTOM_MIN_LEN,
  EMOJI_CHOICES,
  AVATAR_CHOICES,
  PRAISE_PROMPTS,
  SEED_DISHES
};
