/**
 * 验证心率图只用「真实 HealthKit 采样」绘图，且无采样时明确显示空状态：
 *  A) 真实样本路径：
 *    - 曲线 polyline 段数 = 采样点-1，圆点数 = 采样点数
 *    - 峰值/最低标注 = 真实样本的极值（不再 avg±16 编造）
 *    - 区间时长由真实样本按时间加权得到（不再是正弦波统计）
 *    - 横轴按真实时间偏移定位（非等距索引）
 *    - 显示「真实数据 · N 个采样点」徽标
 *  B) 无采样路径（手动/演示记录）：
 *    - 不画任何 polyline/circle/svg
 *    - 显示「暂无真实心率采样数据」空状态
 *    - 区间行不显示伪造的分钟/百分比
 */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = 'file:///' + path.join(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');
const W = 393, H = 852, SAT = 59;

function assert(cond, msg){ if(!cond){ throw new Error('ASSERT FAILED: '+msg); } console.log('  ✓ '+msg); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--allow-file-access-from-files', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await page.evaluate(sat => document.documentElement.style.setProperty('--sat', sat + 'px'), SAT);

  // ---------- A) 真实样本路径 ----------
  const real = await page.evaluate(() => {
    const S = (window.state && window.state.swim) || swimOf();
    S.hist.length = 0;
    // 模拟 HealthKit 逐样本：时间不等距、真实极值 112 / 141
    const rs = new Date('2026-11-17T18:10:00').getTime();
    const re = new Date('2026-11-17T19:00:00').getTime();
    const spec = [
      [0,116],[60,121],[150,128],[240,133],[330,130],[420,124],[510,119],
      [600,125],[690,135],[780,141],[870,132],[960,127],[1050,122],[1140,117],
      [1230,113],[1320,112],[1410,118],[1500,126],[1590,134],[1680,129],
      [1770,123],[1860,119],[1950,124],[2040,131],[2130,137],[2220,130],[2300,120]
    ];
    const samples = spec.map(x => ({ t: rs + x[0]*1000, hr: x[1] }));
    const built = buildRealHrData(samples, rs, re, '18:10');
    const rec = {
      d:'2026-11-17', style:'蛙泳', dist:1500, mins:50, t0:'18:10', t1:'19:00', poolLen:25,
      hid:'FAKE-HK-ID', start:new Date(rs).toISOString(), end:new Date(re).toISOString(),
      avgHR:built.avg, maxHR:built.max, hrMin:built.min,
      hrZones:built.zones, hrCurve:built.curve, hrReal:true,
      hrSampleCount:built.samples.length, hrRealMin:built.realMin, hrRealMax:built.realMax,
      source:'Health'
    };
    S.hist.push(rec);
    swimDetail(0);
    const body = document.getElementById('swimDetailBody');
    const svg = body.querySelector('.hrbox svg');
    const texts = [...svg.querySelectorAll('text')].map(e => e.textContent);
    // 采样点真实时间偏移，检查后段点是否因不等距而 x 间隔不同
    const circles = [...svg.querySelectorAll('circle')];
    const xs = circles.filter(c => c.getAttribute('r') === '1.7').map(c => +c.getAttribute('cx'));
    const gaps = xs.slice(1).map((x,i) => +(x-xs[i]).toFixed(2));
    const uniqGaps = [...new Set(gaps)];
    return {
      built:{ avg:built.avg, max:built.max, min:built.min, zones:built.zones,
              realMin:built.realMin, realMax:built.realMax, n:built.samples.length,
              curveN:built.curve.length },
      segPolylines: svg.querySelectorAll('polyline').length,
      dotCircles: circles.filter(c => c.getAttribute('r') === '1.7').length,
      texts,
      xGaps: uniqGaps,
      hasBadge: !!body.querySelector('.hr-realnote'),
      badge: (body.querySelector('.hr-realnote')||{}).textContent,
      hasEmpty: !!body.querySelector('.hr-nodata'),
      zoneTexts: [...body.querySelectorAll('.zonerow .ztext')].map(e => e.innerText.replace(/\s+/g,' ')),
      titleRange: (body.querySelector('h4 span:last-child')||{}).textContent,
    };
  });
  console.log('\n--- A) 真实样本路径 ---');
  console.log('  built =', JSON.stringify(real.built));
  console.log('  segPolylines =', real.segPolylines, 'dotCircles =', real.dotCircles);
  console.log('  unique x gaps =', JSON.stringify(real.xGaps));
  console.log('  zoneTexts =', JSON.stringify(real.zoneTexts));
  console.log('  titleRange =', real.titleRange, ' badge =', real.badge);
  console.log('  allTexts =', JSON.stringify(real.texts));
  assert(real.built.n === 27, '保留全部 27 个真实采样点');
  assert(real.built.realMin === 112 && real.built.realMax === 141, '真实极值 = 112/141（非 avg±16 编造）');
  assert(real.built.min === 112 && real.built.max === 141, '显示的最值取自真实样本');
  assert(real.segPolylines === real.built.n-1, '曲线分段数 = 真实点数-1');
  assert(real.dotCircles === real.built.n, '每个真实采样点都有圆点标记');
  assert(real.xGaps.length > 1, '横轴按真实时间偏移定位（间距不等，非索引等距）');
  assert(real.hasBadge && real.badge.indexOf('27') >= 0, '显示「真实数据 · 27 个采样点」徽标');
  assert(!real.hasEmpty, '真实数据路径不显示空状态');
  assert(real.zoneTexts.length === 4 && real.zoneTexts.some(t => /分 ·/.test(t)), '4 个区间都显示真实时长');
  assert(real.texts.some(t => t === '峰值 141'), '峰值标注 = 真实最大 141');
  assert(real.texts.some(t => t === '最低 112'), '最低标注 = 真实最小 112');

  // ---------- B) 无采样路径 ----------
  const empty = await page.evaluate(() => {
    const S = swimOf();
    S.hist.length = 0;
    S.hist.push({ d:'2026-11-16', style:'蛙泳', dist:1200, mins:35, t0:'19:00', t1:'19:35',
                  poolLen:25, avgHR:125, maxHR:0, source:'manual' });
    // 模拟手动录入被 enrichSwim 处理
    enrichSwim(S.hist[0]);
    swimDetail(0);
    const body = document.getElementById('swimDetailBody');
    const svg = body.querySelector('.hrbox svg');
    return {
      hasSvg: !!svg,
      polylines: svg ? svg.querySelectorAll('polyline').length : 0,
      circles: svg ? svg.querySelectorAll('circle').length : 0,
      hasEmpty: !!body.querySelector('.hr-nodata'),
      emptyText: (body.querySelector('.hr-nodata')||{}).innerText,
      zoneRows: body.querySelectorAll('.zonerow').length,
      hasBadge: !!body.querySelector('.hr-realnote'),
      avgVal: [...body.querySelectorAll('.swimrow')].find(r=>r.innerText.includes('平均心率')).querySelector('.val').textContent,
    };
  });
  console.log('\n--- B) 无采样路径 ---');
  console.log('  hasSvg =', empty.hasSvg, 'polylines =', empty.polylines, 'circles =', empty.circles);
  console.log('  emptyText =', JSON.stringify(empty.emptyText));
  console.log('  zoneRows =', empty.zoneRows, ' avgVal =', empty.avgVal);
  assert(!empty.hasSvg && empty.polylines===0 && empty.circles===0, '无真实采样时不画任何曲线/SVG');
  assert(empty.hasEmpty && empty.emptyText.indexOf('暂无真实心率采样数据')>=0, '显示明确的空状态说明');
  assert(empty.zoneRows===0, '不显示伪造的区间时长行');
  assert(!empty.hasBadge, '不显示真实数据徽标');
  assert(empty.avgVal.trim()==='—', '平均心率显示「—」而非编造值');

  // ---------- 截图 ----------
  await page.evaluate(() => {
    const S=swimOf(); S.hist.length=0;
    const rs=new Date('2026-11-17T18:10:00').getTime(), re=new Date('2026-11-17T19:00:00').getTime();
    const spec=[[0,116],[60,121],[150,128],[240,133],[330,130],[420,124],[510,119],[600,125],
      [690,135],[780,141],[870,132],[960,127],[1050,122],[1140,117],[1230,113],[1320,112],
      [1410,118],[1500,126],[1590,134],[1680,129],[1770,123],[1860,119],[1950,124],[2040,131],
      [2130,137],[2220,130],[2300,120]];
    const samples=spec.map(x=>({t:rs+x[0]*1000,hr:x[1]}));
    const built=buildRealHrData(samples,rs,re,'18:10');
    S.hist.push({d:'2026-11-17',style:'蛙泳',dist:1500,mins:50,t0:'18:10',t1:'19:00',poolLen:25,
      avgHR:built.avg,maxHR:built.max,hrMin:built.min,hrZones:built.zones,hrCurve:built.curve,
      hrReal:true,hrSampleCount:built.samples.length,hrRealMin:built.realMin,hrRealMax:built.realMax,source:'Health'});
    swimDetail(0);
    document.getElementById('sub-swim-detail').classList.add('show');
  });
  await new Promise(r => setTimeout(r, 600));
  const clip = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('#swimDetailBody .swimsect')]
      .find(s => s.querySelector('h4') && s.querySelector('h4').textContent.includes('心率区间'));
    if (!sec) return null;
    sec.scrollIntoView();
    const r = sec.getBoundingClientRect();
    return { x: Math.max(0,r.x), y: Math.max(0,r.y), width: r.width, height: r.height+8 };
  });
  if (clip) {
    await page.screenshot({ path: path.join(__dirname,'..','hr-zones.png'), clip });
    console.log('\nscreenshot -> hr-zones.png', JSON.stringify(clip));
  }

  if(errs.length){ console.log('\nPAGE ERRORS:', JSON.stringify(errs)); process.exitCode=1; }
  else console.log('\nALL CHECKS PASSED ✅');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.stack); process.exit(1); });
