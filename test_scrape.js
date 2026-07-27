const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time);
    });
}

// Hàm load trang với khả năng tự thử lại nếu rớt mạng
async function gotoWithRetry(page, url, options = {}, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await page.goto(url, options);
        } catch (error) {
            console.log(`Lần thử ${i + 1} thất bại khi truy cập ${url}: ${error.message}`);
            if (i === maxRetries - 1) throw error;
            console.log('Đang thử lại sau 5 giây...');
            await delay(5000);
        }
    }
}

(async () => {
    // --- BƯỚC 1: ĐỌC DANH SÁCH URL ---
    let targetUrls = [];
    const csvPath = path.join(__dirname, 'danhsach_vbpl.csv');

    if (fs.existsSync(csvPath)) {
        console.log(`Đang đọc danh sách URL từ: ${csvPath}`);
        const content = fs.readFileSync(csvPath, 'utf-8');
        targetUrls = content.split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('http'))
            .slice(0, 1); // Chỉ lấy 1 link đầu tiên để test
        console.log(`Tổng cộng có ${targetUrls.length} URL cần cào dữ liệu.`);
    } else {
        console.log(`Không tìm thấy file ${csvPath}. Vui lòng chạy get_links.js trước!`);
        process.exit(1);
    }

    console.log('Khởi động trình duyệt...');
    // Để chạy ngầm hoàn toàn thì đổi headless: "new"
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let allData = []; 
    let buffer = [];  
    const total = targetUrls.length;
    const batchSizeForN8n = 1; // Gom 1 văn bản gửi 1 lần (Test)
    const webhookUrl = 'https://n8n.1022.vn/webhook/vbpl-data'; 

    // --- HÀM GỬI N8N BATCH ---
    async function sendBatch(dataToSend, currentCount, maxRetries = 3) {
        const batchNum = Math.ceil(currentCount / batchSizeForN8n);
        const totalBatches = Math.ceil(total / batchSizeForN8n);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`>>> Đang gửi đợt ${batchNum}/${totalBatches} (Lần thử ${attempt}) lên n8n...`);
                
                const response = await axios.post(webhookUrl, {
                    source: "vbpl_production_js",
                    total_all: total,
                    batch_info: `${batchNum}/${totalBatches}`,
                    data: dataToSend
                }, { timeout: 90000 });

                console.log(`>>> Gửi đợt ${batchNum} thành công. Nghỉ 5s...`);
                await delay(5000); 
                return;
            } catch (e) {
                console.log(`>>> Lỗi gửi đợt ${batchNum} (Lần thử ${attempt}): ${e.message}`);
                if (attempt < maxRetries) {
                    console.log('Thử lại sau 10 giây...');
                    await delay(10000);
                } else {
                    console.log(`!!! Thất bại hoàn toàn đợt ${batchNum} sau ${maxRetries} lần thử.`);
                }
            }
        }
    }

    // --- BƯỚC 2: CÀO DỮ LIỆU TỪNG LINK ---
    for (let i = 0; i < total; i++) {
        const url = targetUrls[i];
        console.log(`\n[${i + 1}/${total}] Đang cào dữ liệu từ: ${url}`);

        try {
            await gotoWithRetry(page, url, { waitUntil: 'networkidle2', timeout: 60000 });
            await delay(2000);

            let properties = {};
            let pdfLink = null;

            // 1. LẤY THUỘC TÍNH
            console.log('  -> Đang bấm sang tab Thuộc tính...');
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a, div, li, span, button'));
                const tab = elements.find(el => el.textContent.trim() === 'Thuộc tính');
                if (tab) tab.click();
            });
            await delay(2000);

            properties = await page.evaluate(() => {
                const result = {};
                const extractByLabel = (label) => {
                    const elements = Array.from(document.querySelectorAll('*'))
                        .filter(el => !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName));
                    const containingElements = elements.filter(el => el.textContent && el.textContent.includes(label));
                    if (containingElements.length === 0) return '';
                    
                    // Lấy element sâu nhất (không có con nào chứa label)
                    const deepestElement = containingElements.find(el => {
                        return Array.from(el.children).every(child => !child.textContent || !child.textContent.includes(label));
                    });
                    
                    if (deepestElement) {
                        const text = deepestElement.textContent.trim();
                        if (text.length > label.length + 1) {
                            return text.replace(label, '').replace(':', '').trim();
                        }
                        
                        if (deepestElement.nextElementSibling) {
                            return deepestElement.nextElementSibling.textContent.trim();
                        }
                        
                        if (deepestElement.parentElement) {
                            return deepestElement.parentElement.innerText.replace(label, '').replace(':', '').trim();
                        }
                    }
                    return '';
                };

                result['SoHieu'] = extractByLabel('Số hiệu');
                result['LoaiVanBan'] = extractByLabel('Loại văn bản');
                result['NgayBanHanh'] = extractByLabel('Ngày ban hành');
                result['CoQuanBanHanh'] = extractByLabel('Cơ quan ban hành');
                result['NguoiKy'] = extractByLabel('Người ký');
                result['Nganh'] = extractByLabel('Ngành');
                result['LinhVuc'] = extractByLabel('Lĩnh vực');
                result['TinhTrangHieuLuc'] = extractByLabel('Tình trạng hiệu lực');
                result['ChucDanh'] = extractByLabel('Chức danh');
                result['NgayCoHieuLuc'] = extractByLabel('Ngày có hiệu lực');
                result['NgayHetHieuLuc'] = extractByLabel('Ngày hết hiệu lực');
                
                return result;
            });
            console.log('  -> Thuộc tính:', properties);

            // BỘ LỌC BỎ QUA QUẢNG NAM
            const isQuangNam = url.toLowerCase().includes('quang-nam') || properties.CoQuanBanHanh.toLowerCase().includes('quảng nam') || properties.CoQuanBanHanh.toLowerCase().includes('quang nam');
            if (isQuangNam) {
                console.log('  -> 🚫 Bỏ qua văn bản này vì thuộc Quảng Nam!');
                continue;
            }

            // 2. LẤY PDF
            console.log('  -> Đang bấm sang tab PDF/Tải về/Văn bản gốc để lấy link...');
            
            const responseHandler = response => {
                const rUrl = response.url();
                // Bắt API download hoặc link trực tiếp
                if (rUrl.includes('.pdf') || rUrl.includes('/download')) {
                    // Nếu là API get doc từ gateway
                    if (rUrl.includes('vbpl-bientap-gateway')) {
                        pdfLink = rUrl;
                    } else if (rUrl.endsWith('.pdf')) {
                        pdfLink = rUrl;
                    }
                }
            };
            page.on('response', responseHandler);

            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a, div, li, span, button'));
                const tab = elements.find(el => {
                    const text = el.textContent.trim().toLowerCase();
                    return text === 'hiển thị pdf' || text === 'văn bản gốc' || text === 'tải về';
                });
                if (tab) tab.click();
            });

            await delay(4000); // Chờ gọi API hoặc mở tab mới

            const pages = await browser.pages();
            if (pages.length > 1) {
                const popup = pages[pages.length - 1];
                if (popup !== page) {
                    if (popup.url().includes('.pdf')) {
                        pdfLink = popup.url();
                    }
                    await popup.close();
                }
            }

            page.off('response', responseHandler);

            // Fallback nếu vẫn không có link thì quét DOM thử iframe
            if (!pdfLink) {
                pdfLink = await page.evaluate(() => {
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                        if (iframe.src && iframe.src.toLowerCase().includes('.pdf')) return iframe.src;
                    }
                    return null;
                });
            }

            if (pdfLink) {
                console.log('  -> ✅ Đã lấy được link PDF:', pdfLink);
            } else {
                console.log('  -> ❌ Không lấy được link PDF cho văn bản này.');
            }

            // Đóng gói data
            const detailData = { url, properties, pdfLink };
            allData.push(detailData);
            buffer.push(detailData);

            // Gửi batch & lưu file local mỗi khi đạt 30 văn bản
            if (buffer.length === batchSizeForN8n) {
                await sendBatch(buffer, i + 1);
                buffer = []; 
                fs.writeFileSync('vbpl_data_production.json', JSON.stringify(allData, null, 2), 'utf-8');
            }

        } catch (e) {
            console.log(`Lỗi tại URL ${url}: ${e.message}`);
        }
    }

    // Gửi nốt mẻ cuối nếu còn
    if (buffer.length > 0) {
        await sendBatch(buffer, total);
        fs.writeFileSync('vbpl_data_production.json', JSON.stringify(allData, null, 2), 'utf-8');
    }

    console.log('\nHOÀN THÀNH TOÀN BỘ DANH SÁCH VÀ ĐÃ LƯU DỮ LIỆU!');
    await browser.close();
})();
