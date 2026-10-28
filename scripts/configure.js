#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_FILE = path.join(ROOT, 'project.config.json');
const CONFIG_FILE = path.join(ROOT, 'miniprogram', 'config.js');
const APPID_RE = /^wx[0-9a-f]{16}$/i;
const ENV_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/;

function usage() {
  console.log([
    '用法：',
    '  node scripts/configure.js --appid wx... --env cloud1-...   云端模式',
    '  node scripts/configure.js --mock [--appid wx...]           本机演示',
    '  node scripts/configure.js --show                           查看当前配置',
    '',
    '可选：--name 夸夸食堂',
    '',
    '先注册正式小程序拿 AppID（接口测试号不支持云开发），',
    '再在开发者工具里开通云开发、创建环境，把环境 ID 填进来。'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = { mock: false, show: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--mock') args.mock = true;
    else if (item === '--show') args.show = true;
    else if (item === '--help' || item === '-h') args.help = true;
    else if (item === '--appid') args.appid = argv[++i];
    else if (item === '--env') args.env = argv[++i];
    else if (item === '--name') args.name = argv[++i];
    else throw new Error('未知参数：' + item);
  }
  return args;
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeProject(project, appid) {
  project.appid = appid;
  fs.writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2) + '\n');
}

function readConfig() {
  delete require.cache[require.resolve(CONFIG_FILE)];
  return require(CONFIG_FILE);
}

function writeConfig(next) {
  const name = String(next.appName).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const content = `'use strict';

module.exports = {
  // 'mock'：本机演示，不需要 AppID；'cloud'：微信云开发，两个人真同步。
  MODE: '${next.mode}',
  CLOUD_ENV_ID: '${next.env}',
  CLOUD_FUNCTION_NAME: 'api',
  APP_NAME: '${name}',
  DEFAULT_CHEF_NAME: '大厨',
  DEFAULT_DINER_NAME: '对象'
};
`;
  fs.writeFileSync(CONFIG_FILE, content);
}

function show(project, config) {
  console.log('当前配置：');
  console.log('  project.config.json appid = ' + (project.appid || '(空)'));
  console.log('  miniprogram/config.js MODE = ' + config.MODE);
  console.log('  CLOUD_ENV_ID = ' + (config.CLOUD_ENV_ID || '(空)'));
  console.log('  APP_NAME = ' + config.APP_NAME);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = readJSON(PROJECT_FILE);
  const config = readConfig();

  if (args.help || (!args.show && !args.mock && !args.appid && !args.env && !args.name)) {
    show(project, config);
    console.log('');
    usage();
    return;
  }

  if (args.show) {
    show(project, config);
    return;
  }

  const appid = args.appid ? String(args.appid).trim() : '';
  if (appid && appid !== 'touristappid' && !APPID_RE.test(appid)) {
    throw new Error('AppID 格式不对：应以 wx 开头、共 18 位，例如 wx1234567890abcdef');
  }

  const mode = args.mock ? 'mock' : 'cloud';
  let env = args.env ? String(args.env).trim() : '';

  if (mode === 'cloud') {
    if (!env) throw new Error('云模式需要 --env 环境 ID；只想本机演示请加 --mock');
    if (!ENV_RE.test(env)) throw new Error('环境 ID 格式不对：' + env);
    const finalAppid = appid || (APPID_RE.test(project.appid || '') ? project.appid : '');
    if (!finalAppid) throw new Error('云模式需要 --appid 小程序 AppID');
  } else {
    env = '';
  }

  if (appid) writeProject(project, appid);
  const appName = args.name ? String(args.name).trim() : (config.APP_NAME || '夸夸食堂');
  if (!appName) throw new Error('App 名称不能为空');
  writeConfig({ mode: mode, env: env, appName: appName });

  console.log('已写入：');
  console.log('  MODE = ' + mode);
  console.log('  CLOUD_ENV_ID = ' + (env || '(空)'));
  console.log('  appid = ' + (appid || project.appid));
  console.log('  APP_NAME = ' + appName);
  console.log('');

  if (mode === 'cloud') {
    console.log('下一步：');
    console.log('  1. 开发者工具里打开云开发，确认环境 ID 一致；');
    console.log('  2. 右键 cloudfunctions/api → 上传并部署：云端安装依赖；');
    console.log('  3. 重新编译小程序，首屏会自动初始化集合和 10 道示例菜。');
  } else {
    console.log('mock 模式：直接编译就能玩，数据只存在本机。');
    console.log('要两个人真同步，换成：node scripts/configure.js --appid wx... --env 你的环境ID');
  }
}

try {
  main();
} catch (error) {
  console.error('配置失败：' + error.message);
  process.exit(1);
}
