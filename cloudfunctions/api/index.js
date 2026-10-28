'use strict';

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { createService, AppError } = require('./lib/service');
const { createCloudRepo } = require('./repo');

const service = createService({ repo: createCloudRepo() });

exports.main = async function main(event) {
  const action = event && event.action;
  const payload = (event && event.payload) || {};
  const wxContext = cloud.getWXContext();

  try {
    const data = await service.dispatch(action, {
      openid: wxContext.OPENID || '',
      appid: wxContext.APPID || ''
    }, payload);
    return { ok: true, data: data };
  } catch (error) {
    console.error('[api] action=' + action, error);
    if (error instanceof AppError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null
        }
      };
    }
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: '后厨出了点问题，稍后再试。'
      }
    };
  }
};
