import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const isProd = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.MYTRAVEL_ADMIN_PASSWORD || (isProd ? '' : 'ChangeMe123!');
const SESSION_SECRET = process.env.MYTRAVEL_SESSION_SECRET || (isProd ? '' : crypto.randomBytes(32).toString('hex'));
const WA_NUMBER = (process.env.MYTRAVEL_WHATSAPP || '919810958069').replace(/\D/g, '');
const DB_PATH = process.env.MYTRAVEL_DB_PATH || path.join(__dirname, 'data', 'mytravel4sure.db');
const ALLOWED_STATUSES = new Set(['new','contacted','qualified','quoted','booked','closed']);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS packages (
  slug TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  destination TEXT,
  travel_month TEXT,
  travellers TEXT,
  trip_type TEXT,
  budget TEXT,
  notes TEXT,
  source TEXT,
  ip_hash TEXT
);
CREATE TABLE IF NOT EXISTS newsletter (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
`);

function seedPackages() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM packages').get();
  if (row.n > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'packages.json'), 'utf8'));
  const ins = db.prepare('INSERT INTO packages(slug,payload,published,updated_at) VALUES(?,?,?,?)');
  const now = new Date().toISOString();
  for (const p of seed) ins.run(p.slug, JSON.stringify(p), p.published === false ? 0 : 1, now);
}
seedPackages();

const rateBuckets = new Map();
function rateLimit(ip, key, limit=12, windowMs=60_000) {
  const now = Date.now(); const k = `${ip}:${key}`;
  const arr = (rateBuckets.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { rateBuckets.set(k, arr); return false; }
  arr.push(now); rateBuckets.set(k, arr); return true;
}
setInterval(() => { const cutoff = Date.now() - 10*60_000; for (const [k,a] of rateBuckets) { const b=a.filter(t=>t>cutoff); b.length?rateBuckets.set(k,b):rateBuckets.delete(k); } }, 5*60_000).unref();

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const securityHeaders = {
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://wa.me; upgrade-insecure-requests"
};
function send(res, status, body, headers={}) { res.writeHead(status,{...securityHeaders,...headers}); res.end(body); }
function json(res,status,obj,headers={}) { send(res,status,JSON.stringify(obj),{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); }
function clean(v,max=300){ return String(v??'').replace(/[\u0000-\u001F\u007F]/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPhone(v){ return /^\+?[0-9][0-9\s()-]{7,19}$/.test(v); }
function ipOf(req){ return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim(); }
function ipHash(req){ return crypto.createHash('sha256').update(ipOf(req)+'|mytravel4sure').digest('hex').slice(0,24); }
async function readBody(req,max=50_000){
  return await new Promise((resolve,reject)=>{ let size=0, data=''; req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('too_large'));req.destroy();return;}data+=c}); req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch{reject(new Error('bad_json'))}}); req.on('error',reject); });
}
function b64u(s){ return Buffer.from(s).toString('base64url'); }
function sign(s){ return crypto.createHmac('sha256',SESSION_SECRET).update(s).digest('base64url'); }
function makeSession(){ const p=b64u(JSON.stringify({exp:Date.now()+8*60*60*1000})); return `${p}.${sign(p)}`; }
function sessionOK(req){ if(!SESSION_SECRET)return false; const c=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mt4s_admin=')); if(!c)return false; const t=c.slice(11),[p,s]=t.split('.'); if(!p||!s)return false; const expSig=sign(p); if(s.length!==expSig.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expSig)))return false; try{return JSON.parse(Buffer.from(p,'base64url')).exp>Date.now()}catch{return false} }
function sameOrigin(req){ const origin=req.headers.origin; if(!origin)return true; const host=req.headers.host; return origin===`http://${host}`||origin===`https://${host}`; }
function waUrl(lead){ const lines=['Hi MyTravel4Sure, I want to plan a trip.',`Name: ${lead.name}`,`Phone: ${lead.phone}`,`Destination: ${lead.destination||'Open to suggestions'}`,`Travel month: ${lead.travel_month||'Flexible'}`,`Travellers: ${lead.travellers||'Not specified'}`,`Trip type: ${lead.trip_type||'Holiday'}`,`Budget: ${lead.budget||'Flexible'}`,`Reference: ${lead.id}`]; return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`; }

function listPackages(url, includeUnpublished=false){
  const rows=db.prepare(`SELECT payload,published FROM packages ${includeUnpublished?'':'WHERE published=1'} ORDER BY updated_at DESC`).all();
  let list=rows.map(r=>({...JSON.parse(r.payload),published:!!r.published}));
  const q=clean(url.searchParams.get('q')||url.searchParams.get('destination')||'',80).toLowerCase();
  const region=clean(url.searchParams.get('region')||'',30).toLowerCase();
  const type=clean(url.searchParams.get('type')||'',30).toLowerCase();
  const budget=clean(url.searchParams.get('budget')||'',50);
  if(q) list=list.filter(p=>[p.title,p.destination,p.region,p.country,p.summary,...(p.tags||[])].join(' ').toLowerCase().includes(q));
  if(region) list=list.filter(p=>String(p.region).toLowerCase()===region);
  if(type) list=list.filter(p=>String(p.type).toLowerCase()===type||p.tags?.some(t=>String(t).toLowerCase()===type));
  if(budget && budget!=='Any budget') list=list.filter(p=>{
    const n=Number(p.startingPrice); if(!Number.isFinite(n)||!n)return false;
    if(budget==='Under ₹50,000')return n<50000;
    if(budget==='₹50,000–₹1,00,000')return n>=50000&&n<=100000;
    if(budget==='₹1,00,000+')return n>100000; return true;
  });
  return list;
}

async function api(req,res,url){
  const ip=ipOf(req);
  if(url.pathname==='/api/health'&&req.method==='GET') return json(res,200,{ok:true,service:'mytravel4sure',time:new Date().toISOString(),persistence:'sqlite'});
  if(url.pathname==='/api/packages'&&req.method==='GET') return json(res,200,{packages:listPackages(url,false)},{'Cache-Control':'public, max-age=60'});
  if(url.pathname.startsWith('/api/packages/')&&req.method==='GET'){
    const slug=clean(decodeURIComponent(url.pathname.split('/').pop()),100); const row=db.prepare('SELECT payload,published FROM packages WHERE slug=? AND published=1').get(slug);
    return row?json(res,200,{package:{...JSON.parse(row.payload),published:true}}):json(res,404,{error:'Package not found'});
  }
  if(url.pathname==='/api/enquiries'&&req.method==='POST'){
    if(!rateLimit(ip,'lead',6,10*60_000))return json(res,429,{error:'Too many requests. Please try again later.'});
    let b; try{b=await readBody(req)}catch(e){return json(res,e.message==='too_large'?413:400,{error:'Invalid request'})}
    if(clean(b.website,120))return json(res,200,{ok:true});
    const lead={id:`MT4S-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,name:clean(b.name,100),phone:clean(b.phone,30),email:clean(b.email,160),destination:clean(b.destination,100),travel_month:clean(b.month||b.travel_month,50),travellers:clean(b.travellers,30),trip_type:clean(b.tripType||b.trip_type,60),budget:clean(b.budget,60),notes:clean(b.notes,1200),source:clean(b.source||'website',80)};
    if(!lead.name||!validPhone(lead.phone)|| (lead.email&&!validEmail(lead.email)))return json(res,422,{error:'Please enter a valid name, phone and email.'});
    const now=new Date().toISOString(); db.prepare('INSERT INTO leads(id,created_at,updated_at,status,name,phone,email,destination,travel_month,travellers,trip_type,budget,notes,source,ip_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(lead.id,now,now,'new',lead.name,lead.phone,lead.email||null,lead.destination,lead.travel_month,lead.travellers,lead.trip_type,lead.budget,lead.notes,lead.source,ipHash(req));
    return json(res,201,{ok:true,leadId:lead.id,whatsappUrl:waUrl(lead)});
  }
  if(url.pathname==='/api/newsletter'&&req.method==='POST'){
    if(!rateLimit(ip,'newsletter',4,10*60_000))return json(res,429,{error:'Too many requests.'}); let b; try{b=await readBody(req)}catch{return json(res,400,{error:'Invalid request'})}
    if(clean(b.website,120))return json(res,200,{ok:true}); const email=clean(b.email,160).toLowerCase(); if(!validEmail(email))return json(res,422,{error:'Enter a valid email address.'});
    db.prepare('INSERT INTO newsletter(email,created_at,source) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').run(email,new Date().toISOString(),clean(b.source||'footer',50)); return json(res,201,{ok:true});
  }
  if(url.pathname==='/api/admin/login'&&req.method==='POST'){
    if(!ADMIN_PASSWORD||!SESSION_SECRET)return json(res,503,{error:'Admin authentication is not configured.'}); if(!rateLimit(ip,'admin-login',5,15*60_000))return json(res,429,{error:'Too many attempts.'}); let b;try{b=await readBody(req,5000)}catch{return json(res,400,{error:'Invalid request'})}
    const given=String(b.password||''); const a=Buffer.from(given), c=Buffer.from(ADMIN_PASSWORD); const ok=a.length===c.length&&crypto.timingSafeEqual(a,c); if(!ok)return json(res,401,{error:'Invalid password.'});
    return json(res,200,{ok:true},{'Set-Cookie':`mt4s_admin=${makeSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${isProd?'; Secure':''}`});
  }
  if(url.pathname==='/api/admin/logout'&&req.method==='POST') return json(res,200,{ok:true},{'Set-Cookie':'mt4s_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
  if(url.pathname.startsWith('/api/admin/')){
    if(!sessionOK(req))return json(res,401,{error:'Authentication required.'}); if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
    if(url.pathname==='/api/admin/leads'&&req.method==='GET') return json(res,200,{leads:db.prepare('SELECT id,created_at,updated_at,status,name,phone,email,destination,travel_month,travellers,trip_type,budget,notes,source FROM leads ORDER BY created_at DESC LIMIT 500').all()});
    if(url.pathname==='/api/admin/newsletter'&&req.method==='GET') return json(res,200,{subscribers:db.prepare('SELECT email,created_at,source FROM newsletter ORDER BY created_at DESC LIMIT 1000').all()});
    if(url.pathname==='/api/admin/packages'&&req.method==='GET') return json(res,200,{packages:listPackages(new URL('http://x'),true)});
    const leadMatch=url.pathname.match(/^\/api\/admin\/leads\/([^/]+)$/); if(leadMatch&&req.method==='PATCH') { let b;try{b=await readBody(req,5000)}catch{return json(res,400,{error:'Invalid request'})}; const status=clean(b.status,20); if(!ALLOWED_STATUSES.has(status))return json(res,422,{error:'Invalid status'}); const r=db.prepare('UPDATE leads SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),clean(leadMatch[1],80)); return r.changes?json(res,200,{ok:true}):json(res,404,{error:'Lead not found'}); }
    const pkgMatch=url.pathname.match(/^\/api\/admin\/packages\/([^/]+)$/); if(pkgMatch&&req.method==='PATCH') { let b;try{b=await readBody(req,80_000)}catch{return json(res,400,{error:'Invalid request'})}; const slug=clean(pkgMatch[1],100); const row=db.prepare('SELECT payload,published FROM packages WHERE slug=?').get(slug); if(!row)return json(res,404,{error:'Package not found'}); const old=JSON.parse(row.payload); const allowed=['title','destination','region','country','type','nights','days','startingPrice','priceStatus','featured','image','summary','availability','tags','highlights','inclusions','itinerary']; for(const k of allowed) if(k in b) old[k]=b[k]; const published='published' in b?!!b.published:!!row.published; db.prepare('UPDATE packages SET payload=?,published=?,updated_at=? WHERE slug=?').run(JSON.stringify({...old,published}),published?1:0,new Date().toISOString(),slug); return json(res,200,{ok:true,package:{...old,published}}); }
  }
  return json(res,404,{error:'API route not found'});
}

function serveFile(req,res,url){
  let rel=decodeURIComponent(url.pathname); if(rel==='/')rel='/index.html';
  const safe=path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/,''); let file=path.join(__dirname,safe);
  if(!file.startsWith(__dirname))return send(res,403,'Forbidden');
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){ file=path.join(__dirname,'404.html'); if(!fs.existsSync(file))return send(res,404,'Not found'); }
  const ext=path.extname(file).toLowerCase(); const cache=ext==='.html'?'no-cache':(file.includes(`${path.sep}assets${path.sep}`)?'public, max-age=86400':'public, max-age=300');
  const stat=fs.statSync(file); res.writeHead(file.endsWith('404.html')?404:200,{...securityHeaders,'Content-Type':MIME[ext]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':cache}); if(req.method==='HEAD')return res.end(); fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{ try{ const rawUrl=String(req.url||'/').replace(/^\/{2,}/,'/'); const url=new URL(rawUrl,`http://${req.headers.host||'localhost'}`); if(url.pathname.startsWith('/api/')) return await api(req,res,url); if(!['GET','HEAD'].includes(req.method))return send(res,405,'Method not allowed'); return serveFile(req,res,url); }catch(err){ console.error(err); return json(res,500,{error:'Internal server error'}); }});
server.listen(PORT,HOST,()=>{
  console.log(`\nMyTravel4Sure production server: http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  if(!isProd) console.log('Local admin password: ChangeMe123! (change before production)');
  if(isProd&&(!ADMIN_PASSWORD||!SESSION_SECRET)) console.warn('WARNING: Set MYTRAVEL_ADMIN_PASSWORD and MYTRAVEL_SESSION_SECRET for admin access.');
});
