'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared');
const TARGETS = [
  path.join(ROOT, 'miniprogram', 'shared'),
  path.join(ROOT, 'cloudfunctions', 'api', 'lib')
];

test('共享模块拷贝与源文件逐字节一致', () => {
  const files = fs.readdirSync(SOURCE).filter(name => name.endsWith('.js')).sort();
  assert.ok(files.length >= 5, 'shared 目录应有 5 个模块');

  TARGETS.forEach(target => {
    files.forEach(name => {
      const src = path.join(SOURCE, name);
      const dst = path.join(target, name);
      assert.ok(fs.existsSync(dst), '缺少拷贝：' + path.relative(ROOT, dst));
      assert.equal(
        fs.readFileSync(dst, 'utf8'),
        fs.readFileSync(src, 'utf8'),
        '拷贝不一致：' + path.relative(ROOT, dst)
      );
    });

    const extras = fs.readdirSync(target)
      .filter(name => name.endsWith('.js') && files.indexOf(name) < 0);
    assert.deepEqual(extras, [], '存在多余的共享模块拷贝：' + target);
  });
});

test('sync --check 通过', () => {
  const result = cp.spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'sync-shared.js'), '--check'],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, (result.stderr || result.stdout || '').trim());
});
