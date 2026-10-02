import fs from 'node:fs';
const base=(process.env.PUBLIC_SITE_URL||'').replace(/\/$/,'');
if(!/^https:\/\//.test(base)){console.error('Set PUBLIC_SITE_URL to the final HTTPS domain, e.g. https://www.example.com');process.exit(1)}
const paths=['/','/holidays.html','/destinations.html','/india.html','/international.html','/honeymoon.html','/experiences.html','/about.html','/contact.html','/privacy.html','/terms.html','/cancellation.html'];
const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(p=>`  <url><loc>${base}${p}</loc></url>`).join('\n')}\n</urlset>\n`;
fs.writeFileSync(new URL('./sitemap.xml',import.meta.url),xml);
fs.writeFileSync(new URL('./robots.txt',import.meta.url),`User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: ${base}/sitemap.xml\n`);
console.log('Generated sitemap.xml and robots.txt for',base);
