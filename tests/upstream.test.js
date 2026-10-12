// Fournisseur CAS/CELCAT synthétique en boucle locale : aucune requête vers l’université.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
const XML='<timetable><event date="2026-09-09"><starttime>14:00</starttime><endtime>16:00</endtime><module>Test</module></event></timetable>';
const FORM='<html><body><form id="fm1" method="post"><input type="hidden" name="execution" value="e1"></form></body></html>';
const ORIGIN='https://edt.example.test';
let server, upstream, base, mode='cas', sessionCookie;
const body=req=>new Promise(resolve=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>resolve(d));});
before(async()=>{
  upstream=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://x');const data=await body(req);
    if(url.pathname==='/xml'){
      if(mode==='entity') {res.setHeader('Content-Type','application/xml');return res.end('<!DOCTYPE t [<!ENTITY a "aaaaaaaaaa">]><timetable><event date="2026-09-09"><starttime>14:00</starttime><module>&a;</module></event></timetable>');}
      if(mode==='expired') {res.writeHead(302,{Location:'/cas/login?service=xml'});return res.end();}
      // Le ticket de service ouvre la session CELCAT (cookie propre au flux).
      if(url.searchParams.get('ticket')==='ST-fixture') {res.writeHead(302,{'Set-Cookie':'CELCAT=ok; Path=/',Location:'/xml'});return res.end();}
      if(req.headers.cookie?.includes('CELCAT=ok')) {res.setHeader('Content-Type','application/xml');return res.end(XML);}
      res.writeHead(302,{Location:'/cas/login?service=xml'});return res.end();
    }
    if(url.pathname==='/cas/login'){
      if(req.method==='GET') return res.end(FORM);
      if(new URLSearchParams(data).get('password')==='good') {res.writeHead(302,{'Set-Cookie':'TGC=cas-secret; Path=/cas',Location:'/xml?ticket=ST-fixture'});return res.end();}
      return res.end(FORM);
    }
    res.statusCode=404;res.end();
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  Object.assign(process.env,{NODE_ENV:'production',PORT:'0',SESSION_SECRET:randomBytes(32).toString('base64'),APP_ORIGIN:ORIGIN,
    CELCAT_XML_URL:`http://127.0.0.1:${upstream.address().port}/xml`,TRUSTED_PROXIES:'192.0.2.1'});
  server=(await import('../server/index.js')).default;
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await Promise.all([server,upstream].filter(Boolean).map(s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);})));});
const login=(username,password)=>fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify({username,password})});

test('CAS synthétique : connexion, mauvais mot de passe, sessions distinctes',async()=>{
  mode='cas';
  const ok=await login('fixture','good');assert.equal(ok.status,200);
  assert.equal((await ok.json()).courses[0].subject,'Test');
  sessionCookie=ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:sessionCookie}})).status,200);
  assert.equal((await login('fixture','bad')).status,401);
  // Sans cookie, aucune session partagée n’est réutilisée.
  assert.equal((await fetch(base+'/api/edt')).status,401);
});
test('XML avec entités personnalisées : refus 502',async()=>{
  assert.ok(sessionCookie);
  mode='entity';assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:sessionCookie}})).status,502);
  mode='cas';assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:sessionCookie}})).status,200);
});
test('Session CAS expirée : 401 SESSION_EXPIRED et cookie supprimé',async()=>{
  assert.ok(sessionCookie);
  // Le fournisseur renvoie désormais la page de connexion CAS (session amont expirée).
  mode='expired';
  const expired=await fetch(base+'/api/edt',{headers:{Cookie:sessionCookie}});
  assert.equal(expired.status,401);assert.equal((await expired.json()).code,'SESSION_EXPIRED');
  assert.match(expired.headers.get('set-cookie'),/Max-Age=0/);
  mode='cas';
});
