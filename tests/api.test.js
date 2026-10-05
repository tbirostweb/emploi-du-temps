import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
let server, upstream, base;
before(async()=>{
  upstream=createServer((_req,res)=>{res.setHeader('Content-Type','application/xml');res.end('<timetable><event date="2026-09-09"><starttime>14:00</starttime><endtime>16:00</endtime><module>Test</module></event></timetable>');});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  process.env.NODE_ENV='production';process.env.PORT='0';
  process.env.SESSION_SECRET=randomBytes(32).toString('base64');
  process.env.APP_ORIGIN='https://edt.example.test';
  process.env.CELCAT_XML_URL=`http://127.0.0.1:${upstream.address().port}/`;
  delete process.env.TRUSTED_PROXIES;
  server=(await import('../server/index.js')).default;
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await Promise.all([server,upstream].filter(Boolean).map(s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);})));});
const ORIGIN='https://edt.example.test';
const post=(body,headers={})=>fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN,...headers},body:JSON.stringify(body)});
test('Production : pages légales, sécurité HTTP et vraie 404',async()=>{
  for(const path of ['/','/mentions-legales','/confidentialite']){
    const r=await fetch(base+path);assert.equal(r.status,200,path);
    assert.ok(r.headers.get('content-security-policy'));assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');
    assert.match(r.headers.get('permissions-policy'),/camera=\(\)/);assert.match(r.headers.get('strict-transport-security'),/max-age=31536000/);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');
  }
  const r=await fetch(base+'/inconnue');assert.equal(r.status,404);assert.match(await r.text(),/Page introuvable/);
});
test('API : session requise, origine et entrées contrôlées',async()=>{
  assert.equal((await fetch(base+'/api/edt')).status,401);
  assert.equal((await post({},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  // Cookie altéré ou forgé : 401 sans appel fournisseur exploitable.
  assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:'edt_session=abc.def.ghi.jkl.mno'}})).status,401);
  assert.equal((await post({username:12,password:'x'})).status,400);
  const tooLarge=await post({username:'u',password:'x'.repeat(9000)});assert.equal(tooLarge.status,413);
});
test('Session production : cookie sécurisé, debug désactivé et logout',async()=>{
  const login=await post({username:'fixture',password:'fixture'});assert.equal(login.status,200);
  const header=login.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Strict/);
  const cookie=header.split(';')[0];
  const r=await fetch(base+'/api/edt?debug=1',{headers:{Cookie:cookie}});
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/json/);
  assert.equal((await r.json()).courses[0].start,'14:00');
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:ORIGIN}});
  assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  // Rejeu du jeton copié après déconnexion : refusé (révocation serveur).
  const replay=await fetch(base+'/api/edt',{headers:{Cookie:cookie}});
  assert.equal(replay.status,401);assert.equal((await replay.json()).code,'SESSION_EXPIRED');
});
test('Login : le plafond bloque aussi les faux X-Forwarded-For',async()=>{
  let last;
  for(let i=0;i<6;i++) last=await post({},{'X-Forwarded-For':`203.0.113.${i+1}`});
  assert.equal(last.status,429);assert.ok(last.headers.get('retry-after'));
});
test('Assets publics : cache durable et compression, API privée non compressée',async()=>{
  const {readdir}=await import('node:fs/promises');
  const files=await readdir(new URL('../dist/assets/',import.meta.url));
  const js=files.find(file=>file.endsWith('.js'));
  const response=await fetch(`${base}/assets/${js}`,{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);
  assert.equal(response.headers.get('content-encoding'),'gzip');
  const html=await fetch(base+'/');assert.equal(html.headers.get('cache-control'),'no-cache');
  const api=await fetch(base+'/api/edt',{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(api.headers.get('cache-control'),'no-store');assert.equal(api.headers.get('content-encoding'),null);
});
