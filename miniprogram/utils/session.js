'use strict';

function boot() {
  return getApp().ensureBoot();
}

function refresh() {
  return getApp().refreshBoot();
}

function homePath(role) {
  return role === 'chef' ? '/pages/kitchen/kitchen' : '/pages/home/home';
}

function toHome(role) {
  wx.switchTab({ url: homePath(role) });
}

function toSetup() {
  wx.reLaunch({ url: '/pages/setup/setup' });
}

async function requireReady(role) {
  const data = await refresh();
  if (!data || data.access !== 'ready') {
    toSetup();
    return null;
  }
  if (role && data.role !== role) {
    toHome(data.role);
    return null;
  }
  return data;
}

module.exports = {
  boot: boot,
  refresh: refresh,
  homePath: homePath,
  toHome: toHome,
  toSetup: toSetup,
  requireReady: requireReady
};
