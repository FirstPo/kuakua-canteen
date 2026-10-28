#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared');
const TARGETS = [
  path.join(ROOT, 'miniprogram', 'shared'),
  path.join(ROOT, 'cloudfunctions', 'api', 'lib')
];
const checkOnly = process.argv.indexOf('--check') >= 0;

function listCanonical() {
  return fs.readdirSync(SOURCE)
    .filter(name => name.endsWith('.js'))
    .sort();
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function main() {
  const files = listCanonical();
  let failures = 0;

  TARGETS.forEach(target => {
    if (!checkOnly) fs.mkdirSync(target, { recursive: true });

    files.forEach(name => {
      const src = path.join(SOURCE, name);
      const dst = path.join(target, name);
      const expected = read(src);
      if (checkOnly) {
        if (!fs.existsSync(dst)) {
          console.error('[缺少] ' + path.relative(ROOT, dst));
          failures++;
          return;
        }
        if (read(dst) !== expected) {
          console.error('[过期] ' + path.relative(ROOT, dst));
          failures++;
        }
        return;
      }
      fs.writeFileSync(dst, expected);
    });

    if (!fs.existsSync(target)) return;
    fs.readdirSync(target).forEach(name => {
      if (!name.endsWith('.js')) return;
      if (files.indexOf(name) >= 0) return;
      const extra = path.join(target, name);
      if (checkOnly) {
        console.error('[多余] ' + path.relative(ROOT, extra));
        failures++;
      } else {
        fs.unlinkSync(extra);
      }
    });
  });

  if (failures) {
    console.error('共享模块有 ' + failures + ' 处不同步，运行 npm run sync 修复。');
    process.exit(1);
  }
  console.log(checkOnly
    ? '共享模块已同步：' + files.length + ' 个文件 × ' + TARGETS.length + ' 份。'
    : '已同步 ' + files.length + ' 个共享模块到 ' + TARGETS.length + ' 个目录。');
}

main();
