'use strict';

const catalog = require('./catalog');

const ENGINE_VERSION = '1.0.0';

const BREAKDOWN_META = [
  { key: 'length', label: '篇幅', max: 25 },
  { key: 'specificity', label: '具体', max: 25 },
  { key: 'emotion', label: '走心', max: 25 },
  { key: 'novelty', label: '新意', max: 15 },
  { key: 'expression', label: '表达', max: 10 }
];

const HARD_FAIL_LABELS = {
  too_short: '有效字数不够',
  duplicate: '和之前的夸奖太像',
  low_variety: '复读太多',
  spam_run: '刷屏',
  emoji_spam: '表情太多',
  spam_punctuation: '标点灌水'
};

const PUNCT_RE = /[\s，。！？、；：…,.!?;:()（）\[\]【】“”‘’《》〈〉「」『』\-—–~～_/\\|·]/;
const TERMINAL_RE = /[。！？!?…；;\n]+/;
const PUNCT_TYPE_RE = /[，。！？、；：…,.!?;:]/;

const CRAFT_RE = /切|炒|颠勺|火候|刀工|调味|摆盘|炖|焖|煎|煮|蒸|炸|揉|擀|下锅|出锅|翻炒|勾芡|收汁|手艺/;
const SENSORY_RE = /香|辣|鲜|咸|甜|脆|嫩|软|糯|入味|好吃|好喝|口感|味道|色泽|油亮|流口水/;
const SCENE_RE = /厨房|围裙|买菜|洗碗|下班|回家|早起|做饭|灶台|锅气|餐桌|冰箱/;
const EFFORT_RE = /辛苦|累|汗|热|忙|早起|晚睡|费心|用心|花心思|操劳/;

const STRONG_RE = /爱|喜欢|幸福|感动|心疼|骄傲|一辈子|永远|一直|每天|未来|陪伴|娶|嫁|想和你|离不开/g;
const GRAT_RE = /谢谢|感谢|辛苦|付出|值得|暖|温柔|贴心|照顾|宠/g;
const ADM_RE = /帅|厉害|棒|优秀|崇拜|男神|天才|绝了|牛|了不起|佩服/g;
const METAPHOR_RE = /像|仿佛|好比|简直是|堪比|如同/;
const MEASURE_RE = /[0-9一二三四五六七八九十百千万]+(分钟|小时|天|年|次|碗|盘|根|片|口|勺|把|顿)/;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return clamp(Math.round(n), min, max);
}

function isEmojiChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp == null) return false;
  return (cp >= 0x1F000 && cp <= 0x1FAFF) ||
    (cp >= 0x1F1E6 && cp <= 0x1F1FF) ||
    (cp >= 0x2600 && cp <= 0x27BF) ||
    (cp >= 0x2B00 && cp <= 0x2BFF) ||
    cp === 0xFE0F ||
    cp === 0x200D;
}

function isPunctChar(ch) {
  return PUNCT_RE.test(ch);
}

function isEffectiveChar(ch) {
  return !/\s/.test(ch) && !isPunctChar(ch) && !isEmojiChar(ch);
}

function effectiveChars(text) {
  return Array.from(String(text == null ? '' : text)).filter(isEffectiveChar);
}

function effectiveLength(text) {
  return effectiveChars(text).length;
}

function normalizeForMatch(text) {
  let s = String(text == null ? '' : text);
  if (typeof s.normalize === 'function') {
    try {
      s = s.normalize('NFKC');
    } catch (e) {
      // 旧引擎不支持 normalize 时保留原文
    }
  }
  return Array.from(s)
    .filter(ch => !/\s/.test(ch) && !isPunctChar(ch) && !isEmojiChar(ch))
    .join('')
    .toLowerCase();
}

function bigrams(text) {
  const chars = Array.from(text);
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

function similarity(a, b) {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (!x || !y) return 0;
  if (x.length < 6 || y.length < 6) return x === y ? 1 : 0;
  if (x === y) return 1;
  const A = bigrams(x);
  const B = bigrams(y);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(item => {
    if (B.has(item)) inter++;
  });
  return inter / (A.size + B.size - inter);
}

function maxSimilarity(text, previousTexts) {
  let max = 0;
  (previousTexts || []).forEach(prev => {
    if (!prev) return;
    const value = similarity(text, prev);
    if (value > max) max = value;
  });
  return max;
}

function countEmoji(chars) {
  let n = 0;
  chars.forEach(ch => {
    if (isEmojiChar(ch)) n++;
  });
  return n;
}

function countPunct(chars) {
  let n = 0;
  chars.forEach(ch => {
    if (isPunctChar(ch)) n++;
  });
  return n;
}

function maxRun(chars) {
  let best = 0;
  let run = 1;
  let last = null;
  chars.forEach(ch => {
    if (ch === last) {
      run++;
    } else {
      run = 1;
      last = ch;
    }
    if (run > best) best = run;
  });
  return best;
}

function uniqueMatches(text, re) {
  const matches = String(text).match(re) || [];
  return Array.from(new Set(matches));
}

function addSuggestion(list, text) {
  if (text && list.indexOf(text) < 0) list.push(text);
}

function scorePraise(text, options) {
  const opts = options || {};
  const minLen = clampInt(opts.minLen, 10, catalog.MAX_CUSTOM_MIN_LEN, catalog.DEFAULT_MIN_LEN);
  const passScore = clampInt(opts.passScore, 60, 100, catalog.DEFAULT_PASS_SCORE);
  const previousTexts = Array.isArray(opts.previousTexts) ? opts.previousTexts.filter(Boolean) : [];
  const dishNames = Array.isArray(opts.dishNames) ? opts.dishNames.filter(Boolean) : [];

  const raw = String(text == null ? '' : text).trim();
  const rawChars = Array.from(raw).filter(ch => !/\s/.test(ch));
  const rawLength = rawChars.length;
  const chars = effectiveChars(raw);
  const length = chars.length;
  const norm = normalizeForMatch(raw);
  const normChars = Array.from(norm);
  const uniqueRatio = normChars.length ? new Set(normChars).size / normChars.length : 0;
  const run = maxRun(normChars);
  const emojiCount = countEmoji(rawChars);
  const punctCount = countPunct(rawChars);
  const segments = raw.split(TERMINAL_RE).map(s => s.trim()).filter(Boolean);
  const punctTypes = Array.from(new Set(rawChars.filter(ch => PUNCT_TYPE_RE.test(ch)))).length;
  const avgSeg = segments.length
    ? segments.reduce((sum, s) => sum + Array.from(s).length, 0) / segments.length
    : rawLength;
  const sim = maxSimilarity(raw, previousTexts);

  const hardFail = [];
  if (length < minLen) hardFail.push('too_short');
  if (sim >= 0.92 && norm.length >= 6) hardFail.push('duplicate');
  if (length >= 10 && uniqueRatio < 0.35) hardFail.push('low_variety');
  if (run >= 8) hardFail.push('spam_run');
  if (rawLength > 0 && emojiCount / rawLength > 0.4) hardFail.push('emoji_spam');
  if (rawLength > 0 && punctCount / rawLength > 0.4) hardFail.push('spam_punctuation');

  const lengthScore = 25 * clamp(length / 55, 0, 1);

  let specificity = 0;
  if (CRAFT_RE.test(raw)) specificity += 5;
  if (SENSORY_RE.test(raw)) specificity += 5;
  if (SCENE_RE.test(raw)) specificity += 5;
  if (EFFORT_RE.test(raw)) specificity += 5;
  if (dishNames.some(name => name && raw.indexOf(name) >= 0)) specificity += 5;
  if (MEASURE_RE.test(raw)) specificity += 3;
  specificity = Math.min(25, specificity);

  const strongHits = uniqueMatches(raw, STRONG_RE);
  const gratHits = uniqueMatches(raw, GRAT_RE);
  const admHits = uniqueMatches(raw, ADM_RE);
  let emotion = strongHits.length * 6 + gratHits.length * 5 + admHits.length * 4;
  if (!strongHits.length && !gratHits.length) {
    emotion = Math.min(emotion, 10);
  }
  if (raw.indexOf('我') >= 0) emotion += 2;
  if (raw.indexOf('我们') >= 0 || raw.indexOf('咱') >= 0) emotion += 2;
  emotion = Math.min(25, emotion);

  let novelty = Math.round(15 * (1 - sim));
  if (sim > 0.75) novelty = Math.min(novelty, 3);
  if (METAPHOR_RE.test(raw)) novelty = Math.min(15, novelty + 3);

  const sentenceScore = segments.length >= 2 ? 5 : (segments.length === 1 ? 2 : 1);
  const punctScore = punctTypes >= 2 ? 3 : (punctTypes === 1 ? 1 : 0);
  const balanceScore = avgSeg >= 8 && avgSeg <= 60 ? 2 : 1;
  const expression = Math.min(10, sentenceScore + punctScore + balanceScore);

  let total = Math.round(lengthScore + specificity + emotion + novelty + expression);
  if (hardFail.length) total = Math.min(total, 49);
  total = clamp(total, 0, 100);

  const passed = hardFail.length === 0 && total >= passScore;

  const suggestions = [];
  if (hardFail.indexOf('too_short') >= 0) {
    addSuggestion(suggestions, '有效字数还差 ' + Math.max(0, minLen - length) + ' 个，别想蒙混过关。');
  }
  if (hardFail.indexOf('duplicate') >= 0) {
    addSuggestion(suggestions, '这句他好像听过，换一个新的说法。');
  }
  if (hardFail.indexOf('low_variety') >= 0 || hardFail.indexOf('spam_run') >= 0) {
    addSuggestion(suggestions, '复读机不算夸奖，说点具体的。');
  }
  if (hardFail.indexOf('emoji_spam') >= 0) {
    addSuggestion(suggestions, '表情包不能当饭钱，也不能当夸奖。');
  }
  if (hardFail.indexOf('spam_punctuation') >= 0) {
    addSuggestion(suggestions, '标点太多，他看不清你的真心。');
  }
  if (specificity < 12) {
    addSuggestion(suggestions, '提一道你点的菜，或夸一个具体动作（刀工、火候、颠勺）。');
  }
  if (emotion < 12) {
    addSuggestion(suggestions, '别只说「厉害」，说说为什么是他做的饭。');
  }
  if (novelty < 8) {
    addSuggestion(suggestions, '换个比喻，或者讲一件你们之间的小事。');
  }
  if (expression < 5) {
    addSuggestion(suggestions, '分成两三句，读起来更像人话。');
  }
  if (length < Math.max(30, minLen + 10)) {
    addSuggestion(suggestions, '再多写两句，他吃这一套。');
  }

  return {
    engineVersion: ENGINE_VERSION,
    score: total,
    passed,
    hardFail,
    suggestions: suggestions.slice(0, 3),
    breakdown: {
      length: Math.round(lengthScore),
      specificity,
      emotion,
      novelty,
      expression
    },
    length,
    rawLength,
    minLen,
    passScore,
    similarity: Number(sim.toFixed(3)),
    stats: {
      uniqueRatio: Number(uniqueRatio.toFixed(3)),
      maxRun: run,
      emojiCount,
      punctCount
    }
  };
}

function gradeFor(score, passed) {
  const n = Number(score) || 0;
  if (passed) {
    if (n >= 95) return { key: 'legend', label: '惊为天人', emoji: '🌟', stamp: '惊为天人' };
    if (n >= 88) return { key: 'great', label: '龙颜大悦', emoji: '👑', stamp: '龙颜大悦' };
    return { key: 'pass', label: '准了', emoji: '✅', stamp: '准了' };
  }
  if (n >= 70) return { key: 'close', label: '差一点', emoji: '😮‍💨', stamp: '差一点' };
  if (n >= 50) return { key: 'weak', label: '不够走心', emoji: '🤔', stamp: '不够走心' };
  return { key: 'bad', label: '重夸', emoji: '🙅', stamp: '重夸' };
}

module.exports = {
  ENGINE_VERSION,
  BREAKDOWN_META,
  HARD_FAIL_LABELS,
  scorePraise,
  gradeFor,
  effectiveLength,
  normalizeForMatch,
  similarity
};
