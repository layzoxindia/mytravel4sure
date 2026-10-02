import fs from 'node:fs';
const url=process.env.SUPABASE_URL?.replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key){console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');process.exit(1)}
const packages=JSON.parse(fs.readFileSync(new URL('./data/packages.json',import.meta.url),'utf8'));
for(const p of packages){
  const r=await fetch(`${url}/rest/v1/packages?on_conflict=slug`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({slug:p.slug,payload:p,published:p.published!==false,updated_at:new Date().toISOString()})});
  if(!r.ok){console.error(p.slug,await r.text());process.exit(1)}
  console.log('seeded',p.slug);
}
console.log('Supabase package catalogue seeded.');
