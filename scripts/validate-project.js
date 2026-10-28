#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const CLOUD = path.join(ROOT, 'cloudfunctions', 'api');
const errors = [];
const warnings = [];
let checks = 0;

function ok() {
  checks++;
}

function err(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function exists(file) {
  return fs.existsSync(file);
}

function readJSON(file) {
  checks++;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    err('JSON 解析失败：' + path.relative(ROOT, file) + ' · ' + error.message);
    return null;
  }
}

function walk(dir, suffix, out) {
  if (!exists(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    if (entry.name === 'node_modules' || entry.name === '.git') return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, suffix, out);
    } else if (entry.name.endsWith(suffix)) {
      out.push(full);
    }
  });
  return out;
}

function checkSyntax(files) {
  files.forEach(file => {
    checks++;
    const result = cp.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      err('JS 语法错误：' + path.relative(ROOT, file) + '\n' + (result.stderr || '').trim());
    }
  });
}

function checkComponentRef(fromJson, ref) {
  let base = null;
  if (ref.startsWith('/')) {
    base = path.join(MP, ref.slice(1));
  } else if (ref.startsWith('.')) {
    base = path.resolve(path.dirname(fromJson), ref);
  } else {
    warn('跳过非本地组件：' + ref + '（' + path.relative(ROOT, fromJson) + '）');
    return;
  }
  ['.js', '.json', '.wxml', '.wxss'].forEach(ext => {
    checks++;
    if (!exists(base + ext)) {
      err('组件缺文件：' + path.relative(ROOT, base + ext));
    }
  });
  if (exists(base + '.js')) {
    checks++;
    const source = fs.readFileSync(base + '.js', 'utf8');
    if (source.indexOf('Component(') < 0) {
      err('组件没有注册 Component：' + path.relative(ROOT, base + '.js'));
    }
  }
}

function checkUsingComponents(jsonFile, json) {
  if (!json || !json.usingComponents) return;
  Object.keys(json.usingComponents).forEach(name => {
    checkComponentRef(jsonFile, json.usingComponents[name]);
  });
}

function checkHandlers(jsFile, wxmlFile, label) {
  if (!exists(jsFile) || !exists(wxmlFile)) return;
  checks++;
  const source = fs.readFileSync(jsFile, 'utf8');
  const wxml = fs.readFileSync(wxmlFile, 'utf8');
  const pattern = /(?:bindtap|bindinput|bindchange|bindchanging|catchtap|bind:action|bind:close|bind:tap)="([A-Za-z_$][\w$]*)"/g;
  const names = new Set();
  let match;
  while ((match = pattern.exec(wxml))) names.add(match[1]);
  names.forEach(name => {
    const defined = new RegExp('(?:^|\\n)\\s*(?:async\\s+)?' + name + '\\s*(?:\\(|:)').test(source);
    if (!defined) err('WXML 绑定了未定义的方法：' + label + ' · ' + name);
  });
}

function checkPage(page) {
  const base = path.join(MP, page);
  ['.js', '.json', '.wxml', '.wxss'].forEach(ext => {
    checks++;
    if (!exists(base + ext)) {
      err('页面缺文件：' + page + ext);
    }
  });
  const json = exists(base + '.json') ? readJSON(base + '.json') : null;
  checkUsingComponents(base + '.json', json);
  if (exists(base + '.js')) {
    checks++;
    const source = fs.readFileSync(base + '.js', 'utf8');
    if (source.indexOf('Page(') < 0) {
      err('页面没有注册 Page：' + page + '.js');
    }
  }
  if (exists(base + '.wxml')) {
    checks++;
    if (!fs.readFileSync(base + '.wxml', 'utf8').trim()) {
      err('WXML 是空的：' + page + '.wxml');
    }
  }
  checkHandlers(base + '.js', base + '.wxml', page);
}

function main() {
  const project = readJSON(path.join(ROOT, 'project.config.json'));
  if (project) {
    checks++;
    if (project.miniprogramRoot !== 'miniprogram/') {
      err('project.config.json 的 miniprogramRoot 应为 miniprogram/');
    }
    checks++;
    if (project.cloudfunctionRoot !== 'cloudfunctions/') {
      err('project.config.json 的 cloudfunctionRoot 应为 cloudfunctions/');
    }
    checks++;
    if (!project.appid) err('project.config.json 缺少 appid');
  }

  const pkg = readJSON(path.join(ROOT, 'package.json'));
  if (pkg) {
    checks++;
    if (!pkg.scripts || !pkg.scripts.test || !pkg.scripts.validate) {
      err('package.json 缺少 test / validate 脚本');
    }
  }

  const appJsonPath = path.join(MP, 'app.json');
  const appJson = readJSON(appJsonPath);
  if (!appJson) {
    err('miniprogram/app.json 不存在或无法解析');
  } else {
    checks++;
    if (!Array.isArray(appJson.pages) || !appJson.pages.length) {
      err('app.json 没有 pages');
    } else {
      appJson.pages.forEach(page => checkPage(page));
    }
    checks++;
    if (!appJson.tabBar || appJson.tabBar.custom !== true) {
      err('app.json 必须开启自定义 tabBar');
    }
    checks++;
    if (!appJson.tabBar || !Array.isArray(appJson.tabBar.list) || appJson.tabBar.list.length !== 5) {
      err('app.json tabBar.list 应有 5 个声明页面');
    } else {
      appJson.tabBar.list.forEach(item => {
        checks++;
        if (!appJson.pages || appJson.pages.indexOf(item.pagePath) < 0) {
          err('tabBar 页面没有在 pages 中声明：' + item.pagePath);
        }
        if (!item.text) err('tabBar 项缺少 text：' + item.pagePath);
      });
    }
    checks++;
    if (!appJson.sitemapLocation || !exists(path.join(MP, appJson.sitemapLocation))) {
      err('app.json 的 sitemapLocation 文件不存在');
    }
  }

  ['app.js', 'app.wxss', 'config.js', 'sitemap.json'].forEach(name => {
    checks++;
    if (!exists(path.join(MP, name))) err('缺少 miniprogram/' + name);
  });

  if (exists(path.join(MP, 'config.js'))) {
    checks++;
    const config = fs.readFileSync(path.join(MP, 'config.js'), 'utf8');
    if (config.indexOf('MODE') < 0) err('config.js 缺少 MODE');
    if (config.indexOf('CLOUD_ENV_ID') < 0) err('config.js 缺少 CLOUD_ENV_ID');
  }

  const tabBarBase = path.join(MP, 'custom-tab-bar', 'index');
  ['.js', '.json', '.wxml', '.wxss'].forEach(ext => {
    checks++;
    if (!exists(tabBarBase + ext)) err('缺少 custom-tab-bar/index' + ext);
  });
  if (exists(tabBarBase + '.js')) {
    checks++;
    const source = fs.readFileSync(tabBarBase + '.js', 'utf8');
    if (source.indexOf('Component(') < 0) err('自定义 tabBar 没有注册 Component');
    if (source.indexOf('selectedKey') < 0) err('自定义 tabBar 缺少 selectedKey');
  }

  if (appJson && Array.isArray(appJson.pages)) {
    const tabPaths = (appJson.tabBar && appJson.tabBar.list || []).map(item => item.pagePath);
    tabPaths.forEach(page => {
      const js = path.join(MP, page + '.js');
      if (!exists(js)) return;
      checks++;
      const source = fs.readFileSync(js, 'utf8');
      if (source.indexOf('getTabBar') < 0 || source.indexOf('selectedKey') < 0) {
        err('tab 页面没有在 onShow 同步 selectedKey：' + page + '.js');
      }
    });
  }

  const componentJsonFiles = walk(path.join(MP, 'components'), '.json', []);
  componentJsonFiles.forEach(file => {
    checkUsingComponents(file, readJSON(file));
  });

  walk(path.join(MP, 'components'), '.wxml', []).forEach(wxmlFile => {
    checkHandlers(
      wxmlFile.replace(/\.wxml$/, '.js'),
      wxmlFile,
      path.relative(MP, wxmlFile)
    );
  });
  if (exists(tabBarBase + '.wxml')) {
    checkHandlers(tabBarBase + '.js', tabBarBase + '.wxml', 'custom-tab-bar');
  }

  ['index.js', 'repo.js', 'package.json'].forEach(name => {
    checks++;
    if (!exists(path.join(CLOUD, name))) err('云函数缺少 ' + name);
  });
  const cloudPkg = exists(path.join(CLOUD, 'package.json'))
    ? readJSON(path.join(CLOUD, 'package.json'))
    : null;
  if (cloudPkg) {
    checks++;
    if (!cloudPkg.dependencies || !cloudPkg.dependencies['wx-server-sdk']) {
      err('云函数 package.json 缺少 wx-server-sdk');
    }
  }
  if (exists(path.join(CLOUD, 'index.js'))) {
    checks++;
    const source = fs.readFileSync(path.join(CLOUD, 'index.js'), 'utf8');
    if (source.indexOf('getWXContext') < 0) err('云函数入口没有读取 getWXContext');
    if (source.indexOf('createService') < 0) err('云函数入口没有接共享 service');
  }

  const jsFiles = []
    .concat(walk(MP, '.js', []))
    .concat(walk(CLOUD, '.js', []))
    .concat(walk(path.join(ROOT, 'shared'), '.js', []))
    .concat(walk(path.join(ROOT, 'scripts'), '.js', []))
    .concat(walk(path.join(ROOT, 'tests'), '.js', []));
  checkSyntax(jsFiles);

  const jsonFiles = []
    .concat(walk(MP, '.json', []))
    .concat(walk(CLOUD, '.json', []));
  jsonFiles.forEach(file => readJSON(file));

  const sync = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-shared.js'), '--check'], {
    encoding: 'utf8'
  });
  checks++;
  if (sync.status !== 0) {
    err('共享模块不同步：\n' + (sync.stderr || sync.stdout || '').trim());
  }

  warnings.forEach(message => console.warn('[提醒] ' + message));
  if (errors.length) {
    console.error('校验失败，共 ' + errors.length + ' 个问题：');
    errors.forEach((message, index) => console.error(' ' + (index + 1) + '. ' + message));
    process.exit(1);
  }
  console.log('项目校验通过：' + checks + ' 项检查。');
}

main();
