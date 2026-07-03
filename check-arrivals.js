const { chromium } = require('playwright');
const fs = require('fs');

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const SEEN_IDS_FILE = 'seen-ids.json';
const MAX_STORED = 800;
const MAX_NOTIFY = 10;
const TARGET_URL = 'https://www.2ndstreet.jp/search?category=921011&sortBy=arrival';

async function main() {
  let seenIds = [];
  if (fs.existsSync(SEEN_IDS_FILE)) {
    try { seenIds = JSON.parse(fs.readFileSync(SEEN_IDS_FILE, 'utf8')); } catch(e) {}
  }

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ja-JP',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('a[href*="/goods/detail/goodsId/"]', { timeout: 30000 });
  } catch(e) {
    console.log('Page load failed:', e.message);
    await browser.close();
    return;
  }

  const items = await page.evaluate(() => {
    const seen = new Set();
    const results = [];
    document.querySelectorAll('a[href*="/goods/detail/goodsId/"]').forEach(a => {
      const m = a.href.match(/\/goods\/detail\/goodsId\/(\d+)\/shopsId\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const nameEl = a.querySelector('p[class*="itemCard_name"]') || a.querySelector('p[class*="name"]');
      results.push({
        id: m[1],
        url: 'https://www.2ndstreet.jp/goods/detail/goodsId/' + m[1] + '/shopsId/' + m[2],
        text: nameEl ? nameEl.textContent.trim() : 'goodsId:' + m[1]
      });
    });
    return results;
  });

  await browser.close();
  console.log('Fetched:', items.length, 'items');

  if (items.length === 0) {
    console.log('0 items - skip');
    return;
  }

  const seenSet = new Set(seenIds);

  if (seenIds.length === 0) {
    console.log('First run - baseline recorded, no notification');
  } else {
    const newItems = items.filter(i => !seenSet.has(i.id));
    console.log('New items:', newItems.length);
    for (const item of newItems.slice(0, MAX_NOTIFY)) {
      await sendLine('セカスト新着\n' + item.text + '\n' + item.url);
    }
  }

  const updated = [...new Set([...items.map(i => i.id), ...seenIds])].slice(0, MAX_STORED);
  fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify(updated));
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
