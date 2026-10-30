#!/usr/bin/env node
/**
 * 原生 Objective-C 静态校验：HealthKit API 误用预检。
 *
 * 背景：CI 的 Xcode 编译是唯一真正的编译器，但反馈周期长（push → 约 1 分钟才失败）。
 * 本脚本在本地拦截几类高频错误（2026-10-30 那次 CI 失败正是其中两类）：
 *   ① 使用了不存在 / 已移除的 HealthKit API
 *   ② NSDateInterval 用错属性名（start/end 而非 startDate/endDate）
 *   ③ HKQuery 的类方法当实例方法用（queryForWorkoutsWithActivityType: 返回 predicate，不是 query）
 *   ④ 括号 / Objective-C 结构不配平
 *   ⑤ 已废弃的直接装箱（@(workout.totalSwimmingStrokeCount)）
 *
 * 纯 Node 实现，无需编译器；退出码非 0 表示存在风险，CI 可在编译前拦截。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  'vendor/cordova-plugin-health/src/ios/HealthKit.m',
];

let errors = 0;
let warnings = 0;

function err(file, msg) { errors++; console.log('  ✗ [ERROR] ' + file + ': ' + msg); }
function warn(file, msg) { warnings++; console.log('  ! [WARN ] ' + file + ': ' + msg); }

/* ---------- 1. 不存在 / 已移除 / 已废弃的 HealthKit API ---------- */
const FORBIDDEN = [
  // 泳池长度：正确的是 HKMetadataKeyLapLength（HKQuantity，长度单位）
  [/HKMetadataKeyPoolLength/, 'HKMetadataKeyPoolLength 不存在，应用 HKMetadataKeyLapLength'],
  // 泳池/公开水域：正确的是 HKMetadataKeySwimmingLocationType（metadata 里的 NSNumber）
  [/(?<!HKMetadataKey)HKSwimmingLocationType/, 'HKSwimmingLocationType 枚举已移除，应读 metadata[HKMetadataKeySwimmingLocationType]'],
  // workoutConfiguration 自 iOS 17 起移除
  [/workout\.workoutConfiguration/, 'workout.workoutConfiguration 自 iOS 17 起已移除'],
  [/workoutConfiguration\s*\]/, 'workoutConfiguration 自 iOS 17 起已移除'],
  // totalSwimmingStrokeCount 自 iOS 17 起返回 HKQuantity*，直接装箱会崩
  [/@\(\s*workout\.totalSwimmingStrokeCount\s*\)/, 'totalSwimmingStrokeCount 自 iOS 17 返回 HKQuantity*，不能直接 @() 装箱，应用 statisticsForType:'],
  // HKQuery 类方法返回的是 predicate，不是 query —— 误用会 "no known class method"
  [/\[\s*HKQuery\s+queryForWorkoutsWithActivityType/, 'queryForWorkoutsWithActivityType: 是返回 NSPredicate 的类方法，不能当 query 用；请用 HKSampleQuery + workoutType'],
  // NSDateInterval 没有 start/end
  [/dateInterval\.start(?!\w)/, 'NSDateInterval 无 start 属性，应为 dateInterval.startDate'],
  [/dateInterval\.end(?!\w)/, 'NSDateInterval 无 end 属性，应为 dateInterval.endDate'],
];

/* ---------- 2. 应当存在的关键 API（防止误删） ---------- */
const REQUIRED = [
  [/HKMetadataKeySwimmingStrokeStyle/, '泳姿 metadata key'],
  [/HKMetadataKeyLapLength/, '单趟长度 metadata key'],
  [/HKMetadataKeySwimmingLocationType/, '泳池/公开水域 metadata key'],
  [/HKWorkoutEventTypeLap/, '逐趟事件枚举'],
  [/workoutEvents/, 'HKWorkout.workoutEvents 属性'],
  [/dateInterval\.startDate/, 'NSDateInterval.startDate'],
  [/dateInterval\.endDate/, 'NSDateInterval.endDate'],
  [/predicateForWorkoutsWithWorkoutActivityType/, 'workout 活动类型谓词'],
  [/statisticsForType/, 'workout 统计取划水次数'],
];

/* ---------- 3. 结构化括号配平（跳过字符串与注释） ---------- */
function checkBalance(file, src) {
  const stack = [];
  const pairs = { '}': '{', ')': '(', ']': '[' };
  let line = 1, i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) { err(file, '第 ' + line + ' 行：块注释未闭合'); return; }
      for (let k = i; k < j; k++) if (src[k] === '\n') line++;
      i = j + 2; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      i = j < 0 ? n : j; continue;
    }
    if (c === '"') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '"') { i++; break; }
        if (src[i] === '\n') line++;
        i++;
      }
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '{' || c === '(' || c === '[') stack.push([c, line]);
    else if (c === '}' || c === ')' || c === ']') {
      if (!stack.length) { err(file, '第 ' + line + ' 行：多余的 ' + c); return; }
      const [o, ol] = stack.pop();
      if (o !== pairs[c]) { err(file, '第 ' + ol + ' 行的 ' + o + ' 未闭合（第 ' + line + ' 行遇到 ' + c + '）'); return; }
    }
    i++;
  }
  if (stack.length) {
    const [o, ol] = stack[stack.length - 1];
    err(file, '第 ' + ol + ' 行的 ' + o + ' 未闭合');
  }
}

/* ---------- 4. Objective-C 结构配平 ---------- */
function checkObjC(file, src) {
  const impl = (src.match(/@implementation/g) || []).length;
  const iface = (src.match(/@interface/g) || []).length;
  const end = (src.match(/@end/g) || []).length;
  if (impl + iface !== end) {
    err(file, '@implementation/@interface 共 ' + (impl + iface) + ' 个，但 @end 只有 ' + end + ' 个');
  }
}

/* ---------- 5. cordova.exec 调用的原生方法必须存在 ---------- */
function checkExecTargets() {
  const html = path.join(ROOT, 'www', 'index.html');
  if (!fs.existsSync(html)) return;
  const js = fs.readFileSync(html, 'utf8');
  const m = fs.readFileSync(path.join(ROOT, 'vendor', 'cordova-plugin-health', 'src', 'ios', 'HealthKit.m'), 'utf8');
  const re = /cordova\.exec\([^,]+,\s*[^,]+,\s*'HealthKit'\s*,\s*'(\w+)'/g;
  let mm, checked = 0;
  while ((mm = re.exec(js)) !== null) {
    const action = mm[1];
    checked++;
    // 原生方法签名：- (void)action:(CDVInvokedUrlCommand *)command
    if (!new RegExp('- \\(void\\)' + action + '\\s*:').test(m)) {
      err('www/index.html', "cordova.exec 调用了原生不存在的动作 '" + action + "'");
    }
  }
  if (checked) console.log('  · 已校验 ' + checked + ' 处 cordova.exec 原生动作');
}

console.log('=== 原生 Objective-C 静态校验 ===\n');

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { err(rel, '文件不存在'); continue; }
  const src = fs.readFileSync(file, 'utf8');
  console.log('[' + rel + ']');

  for (const [re, msg] of FORBIDDEN) {
    const m = src.match(re);
    if (m) {
      // 找到行号
      const idx = src.indexOf(m[0]);
      const line = src.slice(0, idx).split('\n').length;
      err(rel, '第 ' + line + ' 行：' + msg);
    }
  }

  for (const [re, desc] of REQUIRED) {
    if (!re.test(src)) warn(rel, '未找到关键 API：' + desc + ' (' + re.source + ')');
  }

  checkBalance(rel, src);
  checkObjC(rel, src);
  console.log('  · 已检查禁用 API / 必需 API / 括号配平 / ObjC 结构');
}

console.log('');
checkExecTargets();

console.log('\n=== 结果：' + errors + ' 个错误, ' + warnings + ' 个警告 ===');
if (errors) {
  console.log('❌ 存在高风险项，推送前请先修正（这些正是以往 CI 编译失败的直接原因）');
  process.exit(1);
}
console.log('✅ 静态校验通过');
