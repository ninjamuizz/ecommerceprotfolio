import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] || 'reference/screenshots';

const targets = [
  { name: 'home', localPath: '/', livePath: '/' },
  {
    name: 'flavor',
    localPath: '/flavors/cane-sugar-syrups/classic-vanilla/',
    livePath: '/flavors/cane-sugar-syrups/classic-vanilla/',
  },
  {
    name: 'recipe',
    localPath: '/recipes/toffee-macchiato/',
    livePath: '/recipes/toffee-macchiato/',
  },
];

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

const LOCAL_BASE = 'http://localhost:4321';
const LIVE_BASE = 'https://www.stirlingflavors.com';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  for (const t of targets) {
    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });

      // local
      await page.goto(LOCAL_BASE + t.localPath, { waitUntil: 'networkidle0', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot({
        path: path.join(OUT, `${t.name}-${vp.name}-local.png`),
        fullPage: false,
      });

      // live
      try {
        await page.goto(LIVE_BASE + t.livePath, { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot({
          path: path.join(OUT, `${t.name}-${vp.name}-live.png`),
          fullPage: false,
        });
      } catch (e) {
        console.error('LIVE FETCH FAILED', t.name, vp.name, e.message);
      }
      console.log('done', t.name, vp.name);
    }
  }
} finally {
  await browser.close();
}
