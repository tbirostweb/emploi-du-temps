import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
let server, base;
before(async()=>{
  process.env.NODE_ENV='production';process.env.PORT='0';
  process.env.APP_ORIGIN='https://edt.example.test';
  delete process.env.TRUSTED_PROXIES;
  server=(await import('../server/index.js')).default;
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server) await new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});});
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
test('Relais universitaire supprimé : aucun mot de passe ou planning ne part en amont',async()=>{
 assert.equal((await fetch(base+'/api/edt')).status,410);
 const r=await post({username:'fixture',password:'fixture'});
 assert.equal(r.status,410); assert.equal(r.headers.get('set-cookie'),null);
 assert.match((await r.json()).error,/XML local/);
 const out=await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Origin:ORIGIN}});
 assert.equal(out.status,410); assert.equal(out.headers.get('set-cookie'),null);
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
