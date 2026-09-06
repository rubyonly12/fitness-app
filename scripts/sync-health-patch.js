#!/usr/bin/env node
/**
 * 在 `npm install` 之后、`npx cap sync ios` 之前运行。
 * 将仓库内 vendor/ 里已打过补丁的 cordova-plugin-health 文件覆盖回 node_modules，
 * 使 Capacitor 在同步时把「游泳泳姿识别」的原生/JS 改动编译进 iOS 工程。
 *
 * 不依赖任何 npm 包（纯 Node），可在 CI 与本机离线运行。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PLUGIN = 'cordova-plugin-health';
const VENDOR_DIR = path.join(ROOT, 'vendor', PLUGIN);
const PLUGIN_DIR = path.join(ROOT, 'node_modules', PLUGIN);
const EXPECTED_VERSION = '3.2.4';

const FILES = [
  'src/ios/HealthKit.m',      // 原生：读取 HKWorkout.swimmingStrokeStyles 回传 strokeStyle
  'www/ios/health.js',        // JS 桥：把 strokeStyle 透传给上层
];

function fail(msg) {
  console.error('❌ ' + msg);
  process.exit(1);
}

if (!fs.existsSync(PLUGIN_DIR)) {
  fail('未找到 node_modules/' + PLUGIN + '，请先运行 npm install');
}

// 版本校验：补丁基于 3.2.4 整文件覆盖，版本不符时不应静默覆盖，避免破坏原生编译
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'));
  if (pkg.version !== EXPECTED_VERSION) {
    fail(
      'cordova-plugin-health 版本为 ' + pkg.version + '，本补丁仅针对 ' +
      EXPECTED_VERSION + '。请将其锁定为 ' + EXPECTED_VERSION + '（详见 vendor/ 说明），或重新 vendoring 补丁文件。'
    );
  }
} catch (e) {
  fail('无法读取 node_modules/' + PLUGIN + '/package.json：' + e.message);
}

if (!fs.existsSync(VENDOR_DIR)) {
  fail('未找到 vendor/' + PLUGIN + '，补丁源文件缺失');
}

let copied = 0;
for (const rel of FILES) {
  const src = path.join(VENDOR_DIR, rel);
  const dst = path.join(PLUGIN_DIR, rel);
  if (!fs.existsSync(src)) {
    fail('补丁源文件缺失：' + src);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('✓ 已覆盖 ' + PLUGIN + '/' + rel);
  copied++;
}

console.log('完成：' + copied + '/' + FILES.length + ' 个文件已打补丁（游泳泳姿识别）');
