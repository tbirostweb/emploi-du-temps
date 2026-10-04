// Fournisseur CAS/CELCAT synthétique en boucle locale : aucune requête vers l’université.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
const XML='<timetable><event date="2026-09-09"><starttime>14:00</starttime><endtime>16:00</endtime><module>Test</module></event></timetable>';
const FORM='<html><body><form id="fm1" method="post"><input type="hidden" name="execution" value="e1"></form></body></html>';
const ORIGIN='https://edt.example.test';
let server, upstream, evil, base, mode='cas', evilHits=[], collectHits=[];
const body=req=>new Promise(resolve=>{let d='';req.on('data',c=>d+=c);req.on('end',()=>resolve(d));});
before(async()=>{
  evil=createServer(async(req,res)=>{evilHits.push({method:req.method,body:await body(req)});res.end(FORM);});
  await new Promise(resolve=>evil.listen(0,'127.0.0.1',resolve));
  const evilUrl=`http://localhost:${evil.address().port}/cas/login`;
  upstream=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://x');const data=await body(req);
    if(url.pathname==='/collect'){collectHits.push({method:req.method,body:data});return res.end('collect');}
    if(url.pathname==='/xml'){
      if(mode==='evil') {res.writeHead(302,{Location:evilUrl});return res.end();}
      if(mode==='huge') {res.setHeader('Content-Type','application/xml');return res.end(`<timetable>${'<!-- x -->'.repeat(20000)}</timetable>`);}
      if(mode==='entity') {res.setHeader('Content-Type','application/xml');return res.end('<!DOCTYPE t [<!ENTITY a "aaaaaaaaaa">]><timetable><event date="2026-09-09"><starttime>14:00</starttime><module>&a;</module></event></timetable>');}
      if(mode==='public' || req.headers.cookie?.includes('TGC=ok')) {res.setHeader('Content-Type','application/xml');return res.end(XML);}
      res.writeHead(302,{Location:'/cas/login?service=xml'});return res.end();
    }
    if(url.pathname==='/cas/login'){
      if(req.method==='GET') return res.end(FORM);
      if(mode==='post307') {res.writeHead(307,{Location:'/collect'});return res.end();}
      if(new URLSearchParams(data).get('password')==='good') {res.writeHead(302,{'Set-Cookie':'TGC=ok; Path=/',Location:'/xml'});return res.end();}
      return res.end(FORM);
    }
    res.statusCode=404;res.end();
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const host=`127.0.0.1:${upstream.address().port}`;
  Object.assign(process.env,{NODE_ENV:'production',PORT:'0',SESSION_SECRET:randomBytes(32).toString('base64'),APP_ORIGIN:ORIGIN,
    CELCAT_XML_URL:`http://${host}/xml`,CAS_ALLOWED_HOSTS:host,CELCAT_MAX_BYTES:'100000'});
  delete process.env.TRUSTED_PROXIES;
  server=(await import('../server/index.js')).default;
  if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await Promise.all([server,upstream,evil].filter(Boolean).map(s=>new Promise(resolve=>{s.closeAllConnections?.();s.close(resolve);})));});
const login=(username,password)=>fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:JSON.stringify({username,password})});

test('CAS synthétique : connexion, mauvais mot de passe, sessions distinctes',async()=>{
  mode='cas';
  const ok=await login('fixture','good');assert.equal(ok.status,200);
  assert.equal((await ok.json()).courses[0].subject,'Test');
  const cookie=ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await login('fixture','bad')).status,401);
  // Sans cookie, aucune session partagée n’est réutilisée.
  assert.equal((await fetch(base+'/api/edt')).status,401);
});
test('Redirection amont vers un hôte non autorisé : aucun identifiant envoyé',async()=>{
  mode='evil';evilHits=[];
  const r=await login('fixture','secret-fixture');
  assert.equal(r.status,502);assert.equal(evilHits.length,0);
  assert.ok(!JSON.stringify(await r.json()).includes('secret-fixture'));
});
test('Redirection 307/308 après POST : identifiants non renvoyés',async()=>{
  mode='post307';collectHits=[];
  const r=await login('fixture','secret-fixture');
  assert.equal(r.status,502);assert.equal(collectHits.length,0);
});
test('Réponse amont trop volumineuse ou XML avec entités : refus 502',async()=>{
  mode='public';
  const ok=await login('fixture','x');assert.equal(ok.status,200);
  const cookie=ok.headers.get('set-cookie').split(';')[0];
  mode='huge';assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:cookie}})).status,502);
  mode='entity';assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:cookie}})).status,502);
  mode='public';assert.equal((await fetch(base+'/api/edt',{headers:{Cookie:cookie}})).status,200);
});
