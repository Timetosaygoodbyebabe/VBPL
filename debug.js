const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
    await page.goto('https://vbpl.vn/van-ban/dia-phuong?province=thanh-pho-da-nang', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 5000));
    
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h && h.includes('van-ban'));
    });
    console.log("Tìm thấy các link sau:");
    console.log(links.slice(0, 20));
    await browser.close();
})();
