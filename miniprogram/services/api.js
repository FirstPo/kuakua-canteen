'use strict';

const config = require('../config');
const mock = require('./mock-backend');

let cloudInitialized = false;

function initCloud() {
  if (cloudInitialized) return;
  if (!wx.cloud) {
    throw new Error('当前微信版本不支持云开发，请升级微信。');
  }
  if (!config.CLOUD_ENV_ID) {
    throw new Error('还没有填云环境 ID，请先按 README 开通云开发。');
  }
  wx.cloud.init({
    env: config.CLOUD_ENV_ID,
    traceUser: true
  });
  cloudInitialized = true;
}

async function call(action, payload) {
  if (config.MODE === 'mock') {
    return mock.call(action, payload || {});
  }
  if (config.MODE !== 'cloud') {
    throw new Error('config.js 里的 MODE 只能是 mock 或 cloud。');
  }

  initCloud();

  let response;
  try {
    response = await wx.cloud.callFunction({
      name: config.CLOUD_FUNCTION_NAME,
      data: {
        action: action,
        payload: payload || {}
      }
    });
  } catch (error) {
    const wrapped = new Error('云函数没连上，检查一下云环境和网络。');
    wrapped.code = 'NETWORK';
    wrapped.raw = error;
    throw wrapped;
  }

  const result = response && response.result;
  if (!result || result.ok !== true) {
    const info = result && result.error ? result.error : {};
    const error = new Error(info.message || '后厨出了点问题');
    error.code = info.code || 'INTERNAL';
    error.details = info.details || null;
    throw error;
  }
  return result.data;
}

module.exports = {
  call: call,
  mode: config.MODE,
  isMock: config.MODE === 'mock'
};
