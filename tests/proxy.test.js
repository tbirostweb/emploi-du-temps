// F3/F4 : limiteurs derrière un proxy de confiance (boucle locale), CAS synthétique sans réseau.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const FORM='<html><body><form id="fm1" method="post"><input type="hidden" name="execution" value="e1"></form></body></html>';
const ORIGIN='https://edt.example.test';
let server, upstream, base;
before(async()=>{
  // Le CAS refuse toujours les identifiants : chaque essai est un échec (401).
  upstream=createServer((req,res)=>{
    const url=new URL(req.url,'http://x');
    if(url.pathname==='/cas/login'){req.resume();return res.end(FORM);}
    res.writeHead(302,{Location:'/cas/login?service=xml'});res.end();
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{NODE_ENV:'production',PORT:'0',SESSION_SECRET:randomBytes(32).toString('base64'),APP_ORIGIN:ORIGIN,
    CELCAT_XML_URL:`http://127.0.0.1:${upstream.address().port}/xml`,TRUSTED_PROXIES:'127.0.0.1'});
  server=(await import('../server/index.js')).default;
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await Promise.all([server,upstream].filter(Boolean).map(s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);})));});
const login=(username,ip)=>fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN,'X-Forwarded-For':ip},body:JSON.stringify({username,password:'bad'})});

test('F3 : deux clients derrière le proxy de confiance ont des compteurs séparés',async()=>{
  for(let i=0;i<5;i++) assert.equal((await login(`a-${i}`,'198.51.100.1')).status,401);
  assert.equal((await login('a-6','198.51.100.1')).status,429);
  assert.equal((await login('b-1','198.51.100.2')).status,401);
});
test('F4 : 6e essai sur un même identifiant depuis des IP différentes : 429',async()=>{
  for(let i=0;i<5;i++) assert.equal((await login('Victime',`198.51.100.${10+i}`)).status,401);
  // Identifiant normalisé (casse, espaces) : même compteur.
  const r=await login('  victime ','198.51.100.20');
  assert.equal(r.status,429);assert.ok(r.headers.get('retry-after'));
});
test('F3 : démarrage refusé en production sans TRUSTED_PROXIES',()=>{
  const env={...process.env,TRUSTED_PROXIES:'',PORT:'0'};
  const r=spawnSync(process.execPath,[new URL('../server/index.js',import.meta.url).pathname],{env,encoding:'utf8',timeout:20000});
  assert.notEqual(r.status,0);assert.match(r.stderr,/TRUSTED_PROXIES est requis en production/);
});
