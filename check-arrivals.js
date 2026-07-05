const { chromium } = require('playwright');
const fs = require('fs');

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const SEEN_IDS_FILE = 'seen-ids.json';
const MAX_STORED = 800;
const MAX_NOTIFY = 10;

const TARGETS = [
  { url: 'https://www.2ndstreet.jp/search?category=921011&sortBy=arrival', label: 'arrival' },
  { url: 'https://www.2ndstreet.jp/search?category=921011&sortBy=discount-high', label: 'discount' },
  { url: 'https://www.2ndstreet.jp/search?category=810073&maxPrice=6490&sortBy=arrival', label: 'suit' },
  { url: 'https://www.2ndstreet.jp/search?category=810073&sortBy=discount-high', label: 'suit-discount' }
];

async function scrape(url) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = response ? response.status() : 0;
    console.log('HTTP:', status, '/', await page.title());
    if (status !== 200) {
      await browser.close();
      return [];
    }
    await page.waitForSelector('a[href*="/goods/detail/goodsId/"]', { timeout: 60000 });
  } catch(e) {
    console.log('Page load failed:', e.message);
    console.log('Title on error:', await page.title().catch(() => 'N/A'));
    await browser.close();
    return [];
  }

  const results = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    document.querySelectorAll('a[href*="/goods/detail/goodsId/"]').forEach(a => {
      const m = a.href.match(/\/goods\/detail\/goodsId\/(\d+)\/shopsId\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const nameEl = a.querySelector('p[class*="itemCard_name"]') || a.querySelector('p[class*="name"]');
      results.push({
        id: m[1],
        url: a.href,
        text: nameEl ? nameEl.textContent.trim() : 'goodsId:' + m[1]
      });
    });
    return results;
  });

  await browser.close();
  return results;
}

async function main() {
  let seenIds = [];
  if (fs.existsSync(SEEN_IDS_FILE)) {
    try { seenIds = JSON.parse(fs.readFileSync(SEEN_IDS_FILE, 'utf8')); } catch(e) {}
  }

  const seenSet = new Set(seenIds);
  const notified = new Set();
  let allItems = [];

  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    if (i > 0) await new Promise(r => setTimeout(r, 15000));
    const items = await scrape(target.url);
    console.log('Fetched (' + target.label + '):', items.length, 'items');
    if (items.length === 0) continue;
    allItems.push(...items);
    if (seenIds.length === 0) continue;
    const newItems = items.filter(item => !seenSet.has(item.id) && !notified.has(item.id));
    console.log('New (' + target.label + '):', newItems.length);
    for (const item of newItems.slice(0, MAX_NOTIFY)) {
      const prefix = target.label === 'discount'
        ? 'セカスト割引'
        : target.label === 'suit' ? 'セカストスーツ'
        : target.label === 'suit-discount' ? 'セカストスーツ割引'
        : 'セカスト新着';
      await sendLine(prefix + '\n' + item.text + '\n' + item.url);
      notified.add(item.id);
    }
  }

  if (seenIds.length === 0) {
    console.log('First run - baseline recorded');
  }
  const updatedIds = [...new Set([...allItems.map(i => i.id), ...seenIds])].slice(0, MAX_STORED);
  fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify(updatedIds));
}

async function sendLine(text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_TOKEN
    },
    body: JSON.stringify({ to: LINE_USER_ID, messages: [{ type: 'text', text }] })
  });
  console.log('LINE sent:', res.status);
}

main().catch(e => { console.error(e); process.exit(1); });
