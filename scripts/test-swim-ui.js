/**
 * 验证两件事：
 * 1) 游泳详情页顶栏（.subhead）标题位置是否合理（不能被状态栏遮住，也不能低到离谱）
 * 2) 泳姿合并逻辑 applySwimStrokeSamples：dist/count/lap 三路来源混合时，
 *    趟数不能重复计数，泳姿优先取 lap（官方）来源
 *
 * 模拟 iPhone 15 Pro：393x852 pt，安全区顶部 59pt（灵动岛机型）
 */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = 'file:///' + path.join(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');

// iPhone 15 Pro 逻辑分辨率
const W = 393, H = 852, SAT = 59;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--allow-file-access-from-files', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.goto(FILE, { waitUntil: 'networkidle0' });
  // 模拟真机：env(safe-area-inset-top) 在桌面浏览器取不到，手动写入 --sat
  await page.evaluate((sat) => {
    document.documentElement.style.setProperty('--sat', sat + 'px');
  }, SAT);

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => {
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  -> ' + detail : ''));
    ok ? pass++ : fail++;
  };

  // ============ 1. 顶栏位置 ============
  const bar = await page.evaluate(async () => {
    const sp = document.getElementById('sub-swim-detail');
    sp.classList.add('show');
    // 等入场动画（slidein .25s，含 translateX(70px)）结束，否则测到的是动画中间态
    await new Promise(r => setTimeout(r, 600));
    const head = sp.querySelector('.subhead');
    const t = sp.querySelector('.subhead .t');
    const btn = sp.querySelector('.backbtn');
    const hr = head.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return {
      headTop: hr.top, headH: hr.height,
      titleTop: tr.top, titleH: tr.height, titleCenter: tr.top + tr.height / 2,
      btnTop: br.top, btnH: br.height, btnLeft: br.left, btnW: br.width,
      titleLeft: tr.left, titleW: tr.width,
      animating: getComputedStyle(sp).transform,
    };
  });
  console.log('\n[顶栏实测] iPhone 15 Pro 视口 ' + W + 'x' + H + ' 安全区 ' + SAT + 'pt');
  console.log('  标题文字中心 y = ' + bar.titleCenter.toFixed(1) + 'pt（状态栏底部 ' + SAT + 'pt）');
  console.log('  标题文字顶部 y = ' + bar.titleTop.toFixed(1) + 'pt');
  console.log('  顶栏高度 = ' + bar.headH.toFixed(1) + 'pt，返回按钮 left=' + bar.btnLeft.toFixed(1) + ' w=' + bar.btnW.toFixed(1));

  // 标题必须完全在状态栏下方（不能被遮）
  check('标题顶部在状态栏下方', bar.titleTop >= SAT, 'titleTop=' + bar.titleTop.toFixed(1) + ' >= ' + SAT);
  // 标题不能低得离谱：文字中心距状态栏底部应在 8~46pt 内（iOS 导航栏惯例）
  const gap = bar.titleCenter - SAT;
  check('标题距状态栏距离合理(8~46pt)', gap >= 8 && gap <= 46, 'gap=' + gap.toFixed(1) + 'pt');
  // 标题水平居中
  const titleMid = bar.titleLeft + bar.titleW / 2;
  check('标题水平居中', Math.abs(titleMid - W / 2) < 2, 'mid=' + titleMid.toFixed(1) + ' vs ' + W / 2);
  // 返回按钮不能贴边（44pt 按钮起点应在 18pt 内边距处）
  check('返回按钮起点不贴边', bar.btnLeft <= 20 && bar.btnLeft >= 14, 'btnLeft=' + bar.btnLeft.toFixed(1));

  // 滚动后顶栏吸顶位置
  const stuck = await page.evaluate(() => {
    const sp = document.getElementById('sub-swim-detail');
    sp.scrollTop = 400;
    const head = sp.querySelector('.subhead');
    const t = sp.querySelector('.subhead .t');
    const tr = t.getBoundingClientRect();
    const hr = head.getBoundingClientRect();
    return { headTop: hr.top, titleTop: tr.top, titleCenter: tr.top + tr.height / 2 };
  });
  console.log('  滚动 400px 后：顶栏 top=' + stuck.headTop.toFixed(1) + ' 标题中心=' + stuck.titleCenter.toFixed(1));
  check('滚动后标题仍不被状态栏遮住', stuck.titleTop >= SAT - 1, 'titleTop=' + stuck.titleTop.toFixed(1));

  // ============ 2. 泳姿合并逻辑 ============
  console.log('\n[泳姿合并逻辑]');
  const swimTest = await page.evaluate(() => {
    const S = { connected: true, hist: [] };
    // 一次游泳：2026-10-30 12:18 - 13:06 (本地时间)
    const rec = {
      d: '2026-10-30', style: '游泳', dist: 2065, mins: 48, kcal: 284,
      t0: '12:18', t1: '13:06',
      start: new Date('2026-10-30T04:18:00Z').toISOString(),
      end: new Date('2026-10-30T05:06:00Z').toISOString(),
      openWater: false, poolLen: 25, hid: 'test-1', source: 'Health',
    };
    S.hist.push(rec);

    // 构造三路混合的原生返回：59 趟距离样本(35m) + 59 趟 count 样本 + 59 个 lap 事件(蛙泳)
    const samples = [];
    const base = new Date('2026-10-30T04:18:00Z').getTime();
    for (let i = 0; i < 59; i++) {
      const s = new Date(base + i * 48863).toISOString(); // 每趟约 48.8s
      samples.push({ start: s, end: s, stroke: '', m: 35, src: 'dist' });
      samples.push({ start: s, end: s, stroke: 'breaststroke', m: 0, src: 'count' });
      samples.push({ start: s, end: s, stroke: 'breaststroke', m: 35, src: 'lap' });
    }
    const n = window.applySwimStrokeSamples(samples, S);
    return { upd: n, style: rec.style, laps: rec.laps, poolLen: rec.poolLen };
  });
  console.log('  结果: ' + JSON.stringify(swimTest));
  check('趟数=59（未被三路重复计数）', swimTest.laps === 59, 'laps=' + swimTest.laps);
  check('泳池长度=35 米', swimTest.poolLen === 35, 'poolLen=' + swimTest.poolLen);
  check('泳姿=蛙泳（取自 lap 来源）', swimTest.style === '蛙泳', 'style=' + swimTest.style);

  // 只有 count 来源（无 dist、无 lap）时，泳姿仍应正确
  const countOnly = await page.evaluate(() => {
    const S = { connected: true, hist: [] };
    const rec = {
      d: '2026-10-30', style: '游泳', dist: 2065, mins: 48, kcal: 284,
      t0: '12:18', t1: '13:06',
      start: new Date('2026-10-30T04:18:00Z').toISOString(),
      end: new Date('2026-10-30T05:06:00Z').toISOString(),
      openWater: false, poolLen: 25, hid: 'test-2', source: 'Health',
    };
    S.hist.push(rec);
    const samples = [];
    const base = new Date('2026-10-30T04:18:00Z').getTime();
    for (let i = 0; i < 59; i++) {
      const s = new Date(base + i * 48863).toISOString();
      samples.push({ start: s, end: s, stroke: 'freestyle', m: 0, src: 'count' });
    }
    window.applySwimStrokeSamples(samples, S);
    return { style: rec.style, laps: rec.laps };
  });
  console.log('  仅 count 来源: ' + JSON.stringify(countOnly));
  check('仅 count 来源时泳姿=自由泳', countOnly.style === '自由泳', 'style=' + countOnly.style);
  check('仅 count 来源时趟数=59', countOnly.laps === 59, 'laps=' + countOnly.laps);

  // lap 来源优先于 count（即使 count 是自由泳、lap 是蛙泳，应取蛙泳）
  const priority = await page.evaluate(() => {
    const S = { connected: true, hist: [] };
    const rec = {
      d: '2026-10-30', style: '游泳', dist: 2065, mins: 48, kcal: 284,
      t0: '12:18', t1: '13:06',
      start: new Date('2026-10-30T04:18:00Z').toISOString(),
      end: new Date('2026-10-30T05:06:00Z').toISOString(),
      openWater: false, poolLen: 25, hid: 'test-3', source: 'Health',
    };
    S.hist.push(rec);
    const samples = [];
    const base = new Date('2026-10-30T04:18:00Z').getTime();
    for (let i = 0; i < 59; i++) {
      const s = new Date(base + i * 48863).toISOString();
      samples.push({ start: s, end: s, stroke: 'freestyle', m: 0, src: 'count' });
      samples.push({ start: s, end: s, stroke: 'breaststroke', m: 35, src: 'lap' });
    }
    window.applySwimStrokeSamples(samples, S);
    return { style: rec.style, laps: rec.laps };
  });
  console.log('  lap 优先级: ' + JSON.stringify(priority));
  check('lap 来源优先于 count 来源', priority.style === '蛙泳', 'style=' + priority.style);
  check('lap+count 混合时趟数仍=59', priority.laps === 59, 'laps=' + priority.laps);

  console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
