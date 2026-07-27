const fs = require('fs');
const html = fs.readFileSync('list.html', 'utf8');
const links = Array.from(html.matchAll(/href="([^"]+)"/g)).map(m => m[1]);
console.log(links.slice(0, 50));
