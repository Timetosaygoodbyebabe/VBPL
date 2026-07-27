const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function getLinks() {
    const listUrl = 'https://vbpl.vn/van-ban/dia-phuong?province=thanh-pho-da-nang';
    console.log('Khởi động trình duyệt để lấy đường dẫn (link)...');
    
    // Khởi động browser
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    try {
        await page.goto(listUrl, { waitUntil: 'networkidle2' });
        console.log('Chờ 10 giây để tải trang (hoặc để bạn vượt Captcha)...');
        await new Promise(r => setTimeout(r, 10000));

        let currentPageNum = 1;
        let allLinks = [];
        let skipToPage = 1;
        
        const csvPath = path.join(__dirname, 'danhsach_vbpl.csv');
        if (fs.existsSync(csvPath)) {
            const content = fs.readFileSync(csvPath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim().length > 0);
            if (lines.length > 1) {
                const fetchedLinks = lines.length - 1;
                skipToPage = Math.floor(fetchedLinks / 10) + 1;
                console.log(`Tìm thấy file CSV cũ với ${fetchedLinks} link. Sẽ Resume (Tiếp tục) từ trang ${skipToPage}...`);
            } else {
                fs.writeFileSync(csvPath, 'url\n', 'utf-8');
            }
        } else {
            fs.writeFileSync(csvPath, 'url\n', 'utf-8');
        }

        while (true) {
            console.log(`\n========== ĐANG XỬ LÝ TRANG: ${currentPageNum} ==========`);
            
            if (currentPageNum < skipToPage) {
                console.log(`Bỏ qua để nhảy nhanh đến trang ${skipToPage}...`);
                const hasNextPage = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const nextBtn = buttons.find(el => el.textContent.trim() === 'Sau');
                    if (nextBtn && !nextBtn.disabled && (!nextBtn.className || typeof nextBtn.className !== 'string' || !nextBtn.className.includes('disabled'))) {
                        nextBtn.click();
                        return true;
                    }
                    return false;
                });

                if (hasNextPage) {
                    await new Promise(r => setTimeout(r, 1000));
                    currentPageNum++;
                    continue;
                } else {
                    break;
                }
            }
            
            // Tìm số lượng văn bản
            const elementsCount = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('div, span')).filter(el => 
                    el.className && typeof el.className === 'string' && el.className.includes('DocumentCard_documentTitle')
                );
                return items.length;
            });

            if (elementsCount === 0) {
                console.log('❌ Không tìm thấy thẻ văn bản nào. Có thể do lỗi mạng, chưa qua Captcha hoặc đã hết danh sách.');
                break;
            }

            console.log(`✅ Tìm thấy ${elementsCount} văn bản. Bắt đầu bấm để lấy link...`);

            // Mở từng thẻ để lấy link
            for (let i = 0; i < elementsCount; i++) {
                const waitForDetailTab = new Promise(resolve => {
                    const listener = async (target) => {
                        if (target.type() === 'page') {
                            const newPage = await target.page();
                            if (newPage) {
                                browser.off('targetcreated', listener);
                                resolve(newPage);
                            }
                        }
                    };
                    browser.on('targetcreated', listener);
                    setTimeout(() => { browser.off('targetcreated', listener); resolve(null); }, 5000);
                });

                // Click
                await page.evaluate((index) => {
                    const items = Array.from(document.querySelectorAll('div, span')).filter(el => 
                        el.className && typeof el.className === 'string' && el.className.includes('DocumentCard_documentTitle')
                    );
                    if (items[index]) items[index].click();
                }, i);

                const detailPage = await waitForDetailTab;
                if (detailPage) {
                    // Đợi url mới nạp vào thanh địa chỉ
                    await new Promise(r => setTimeout(r, 2000));
                    let url = detailPage.url();
                    
                    if (url === 'about:blank' || url.includes('about:blank')) {
                        // Nếu vẫn about:blank thì đợi thêm xíu
                        await new Promise(r => setTimeout(r, 3000));
                        url = detailPage.url();
                    }

                    allLinks.push(url);
                    // Ghi ngay lập tức vào file (append) để lỡ crash cũng không mất data cũ
                    fs.appendFileSync(csvPath, `${url}\n`, 'utf-8');
                    
                    console.log(`  -> Lấy được: ${url}`);
                    await detailPage.close();
                } else {
                    console.log(`  -> ⚠️ Không có tab mới mở ra ở mục ${i+1}. Bỏ qua.`);
                }
            }

            // Chuyển trang
            const hasNextPage = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const nextBtn = buttons.find(el => el.textContent.trim() === 'Sau');
                if (nextBtn && !nextBtn.disabled && (!nextBtn.className || typeof nextBtn.className !== 'string' || !nextBtn.className.includes('disabled'))) {
                    nextBtn.click();
                    return true;
                }
                return false;
            });

            if (hasNextPage) {
                console.log('✅ Đã bấm sang trang tiếp theo. Chờ load...');
                await new Promise(r => setTimeout(r, 4500));
                currentPageNum++;
            } else {
                console.log('🚫 Không tìm thấy nút Next hoặc đã đến trang cuối cùng.');
                break;
            }
        }

        console.log(`\n🎉 Hoàn tất! Đã lưu tổng cộng ${allLinks.length} đường dẫn vào file: ${csvPath}`);

    } catch (e) {
        console.error('Lỗi trong quá trình lấy link:', e);
    } finally {
        await browser.close();
    }
}

getLinks();
