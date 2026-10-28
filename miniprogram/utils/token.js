'use strict';

function hash(text) {
  let value = 5381;
  const source = String(text == null ? '' : text);
  for (let i = 0; i < source.length; i++) {
    value = ((value << 5) + value + source.charCodeAt(i)) >>> 0;
  }
  return value.toString(36);
}

function makeDraftId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function tokenFor(draftId, extra, text) {
  return 'p' + hash(String(draftId) + '|' + String(extra || '') + '|' + String(text || ''));
}

module.exports = {
  makeDraftId: makeDraftId,
  tokenFor: tokenFor
};
