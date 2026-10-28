'use strict';

const config = require('./config');
const api = require('./services/api');

App({
  globalData: {
    mode: config.MODE,
    access: '',
    role: null,
    user: null,
    partner: null,
    settings: null,
    boot: null,
    bootError: null,
    ready: false
  },

  onLaunch() {
    this.ensureBoot().catch(() => {});
  },

  ensureBoot() {
    if (!this._bootPromise) {
      this._bootPromise = this.bootstrap().catch(error => {
        this._bootPromise = null;
        this.globalData.bootError = error;
        throw error;
      });
    }
    return this._bootPromise;
  },

  refreshBoot() {
    const previous = this._bootPromise || Promise.resolve();
    this._bootPromise = previous
      .catch(() => null)
      .then(() => this.bootstrap())
      .catch(error => {
        this._bootPromise = null;
        this.globalData.bootError = error;
        throw error;
      });
    return this._bootPromise;
  },

  async bootstrap() {
    const data = await api.call('bootstrap', {});
    this.applyBoot(data);
    return data;
  },

  applyBoot(data) {
    this.globalData.access = data.access;
    this.globalData.role = data.role || null;
    this.globalData.user = data.user || null;
    this.globalData.partner = data.partner || null;
    this.globalData.settings = data.settings || null;
    this.globalData.boot = data;
    this.globalData.bootError = null;
    this.globalData.ready = true;
  }
});
