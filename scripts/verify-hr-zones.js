/**
 * 验证心率区间模块改进：
 *  - 4 档均显示具体 BPM 区间（不再笼统）
 *  - 图表含 y 轴 BPM 刻度 + 区间色带 + 峰值红点
 *  - 标题含 ⓘ 说明入口
 *  - 标题范围、各档时长/占比正常
 */
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = 'file:///' + path.join(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');
const W = 393, H = 852, SAT = 59;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--allow-file-access-from-files', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(FILE, { waitUntil: 'networkidle0' });
  await page.evaluate(sat => document.documentElement.style.setProperty('--sat', sat + 'px'), SAT);

  const data = await page.evaluate(() => {
    const S = (window.state && window.state.swim) || (window.swimOf && swimOf());
    if (!S.hist.length) {
      S.hist.push({ d: '2026-10-30', style: '蛙泳', dist: 1500, mins: 49,
        t0: '12:18', t1: '13:07', poolLen: 25, avgHR: 128, maxHR: 152 });
    }
    if (window.enrichSwim) enrichSwim(S.hist[0]);
    swimDetail(0);
    const body = document.getElementById('swimDetailBody');
    const svg = body.querySelector('.hrbox svg');
    const texts = [...svg.querySelectorAll('text')].map(e => e.textContent);
    return {
      zoneCount: body.querySelectorAll('.zonerow').length,
      zoneTexts: [...body.querySelectorAll('.zonerow .ztext')].map(e => e.innerText.replace(/\s+/g, ' ')),
      barWidths: [...body.querySelectorAll('.zonerow .zbar i')].map(i => i.style.width),
      hasInfo: !!body.querySelector('h4 .info'),
      titleRange: (body.querySelector('h4 span:last-child') || {}).textContent,
      rects: svg.querySelectorAll('rect').length,
      segPolylines: svg.querySelectorAll('polyline').length,
      circles: svg.querySelectorAll('circle').length,
      allTexts: texts,
      hasAvg: texts.some(t => t.indexOf('平均') >= 0),
      hasPeak: texts.some(t => t.indexOf('峰值') >= 0),
      hasMin: texts.some(t => t.indexOf('最低') >= 0),
      zoneNameLabels: ['热身', '燃脂', '有氧', '峰值'].filter(n => texts.some(t => t.indexOf(n) >= 0)),
      bpmTicks: texts.filter(t => /^\d{2,3}$/.test(t)),
      hrRefMax: (window.hrRefMax ? hrRefMax() : 'n/a'),
      bounds: (window.hrZoneBounds ? hrZoneBounds().map(b => b.cat + ' ' + b.lo + '–' + b.hi) : 'n/a'),
    };
  });
  console.log('zoneCount =', data.zoneCount);
  console.log('titleRange =', data.titleRange);
  console.log('hasInfo =', data.hasInfo);
  console.log('hrRefMax =', data.hrRefMax);
  console.log('bounds =', JSON.stringify(data.bounds));
  console.log('zoneTexts =', JSON.stringify(data.zoneTexts, null, 0));
  console.log('barWidths =', JSON.stringify(data.barWidths));
  console.log('chart rects(bands) =', data.rects, ' segPolylines =', data.segPolylines, ' circles =', data.circles);
  console.log('bpmTicks =', JSON.stringify(data.bpmTicks));
  console.log('zoneNameLabels =', JSON.stringify(data.zoneNameLabels));
  console.log('hasAvg/Peak/Min =', data.hasAvg, data.hasPeak, data.hasMin);
  console.log('allTexts =', JSON.stringify(data.allTexts));

  // 截图：打开游泳详情并滚动到心率区间
  await page.evaluate(() => { document.getElementById('sub-swim-detail').classList.add('show'); });
  await new Promise(r => setTimeout(r, 700));
  const clip = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('#swimDetailBody .swimsect')]
      .find(s => s.querySelector('h4') && s.querySelector('h4').textContent.includes('心率区间'));
    if (!sec) return null;
    sec.scrollIntoView();
    const r = sec.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height + 8 };
  });
  if (clip) {
    await page.screenshot({ path: path.join(__dirname, '..', 'hr-zones.png'), clip });
    console.log('screenshot -> hr-zones.png', JSON.stringify(clip));
  }
  await browser.close();
})();
