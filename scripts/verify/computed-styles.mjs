import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:4321';

const pages = [
  { name: 'home', path: '/' },
  { name: 'flavor', path: '/flavors/cane-sugar-syrups/classic-vanilla/' },
  { name: 'recipe', path: '/recipes/toffee-macchiato/' },
];

const widths = [1920, 1440, 1280, 1024, 768, 430, 390, 360];

const results = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  for (const p of pages) {
    await page.goto(BASE + p.path, { waitUntil: 'networkidle0' });
    for (const w of widths) {
      await page.setViewport({ width: w, height: 1000 });
      // let layout settle
      await new Promise((r) => setTimeout(r, 100));
      const data = await page.evaluate(() => {
        function cs(el) {
          if (!el) return null;
          const s = getComputedStyle(el);
          return { fontSize: s.fontSize, lineHeight: s.lineHeight };
        }
        const h1 = document.querySelector('h1');
        const body = document.body;
        // try to find a flavor grid on homepage
        const grid = document.querySelector('[data-grid]');
        let gridInfo = null;
        if (grid) {
          const gs = getComputedStyle(grid);
          const children = Array.from(grid.children).filter(
            (c) => getComputedStyle(c).display !== 'none'
          );
          const lefts = [...new Set(children.map((c) => Math.round(c.getBoundingClientRect().left)))];
          gridInfo = {
            display: gs.display,
            gridTemplateColumns: gs.gridTemplateColumns,
            trackCount: gs.gridTemplateColumns ? gs.gridTemplateColumns.split(' ').length : null,
            visualColumnCount: lefts.length,
            containerWidth: Math.round(grid.getBoundingClientRect().width),
          };
        }
        return {
          h1: cs(h1),
          body: cs(body),
          grid: gridInfo,
        };
      });
      results.push({ page: p.name, width: w, ...data });
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
