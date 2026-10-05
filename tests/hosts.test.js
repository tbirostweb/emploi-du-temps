import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
process.env.CELCAT_XML_URL='https://celcat-auth.example.test/groupes/flux.xml';
const {parentDomain,assertAllowedUrl,checkUpstreamConfig,UpstreamPolicyError}=await import('../server/lib/celcat-auth.js');
const ok=u=>assert.doesNotThrow(()=>assertAllowedUrl(u),u);
const ko=u=>assert.throws(()=>assertAllowedUrl(u),UpstreamPolicyError,u);
test('Hôte du flux, domaine parent et sous-domaines autorisés (HTTPS)',()=>{
  ok('https://celcat-auth.example.test/x');ok('https://example.test/cas/login');ok('https://cas.example.test/cas/login?service=x');ok('https://a.b.example.test/');
});
test('Hôtes hors domaine, HTTP, IP, port, identifiants refusés',()=>{
  ko('https://example.evil/cas/login');ko('https://example.test.evil/');ko('https://evilexample.test/');ko('https://127.0.0.1/');ko('https://[::1]/');
  ko('http://cas.example.test/cas/login');ko('http://example.test/');ko('https://cas.example.test:8443/');ko('https://u:p@cas.example.test/');
});
test('Message clair, sans chemin ni jeton dans l’hôte porté par l’erreur',()=>{
  try{assertAllowedUrl('https://other.invalid/cas?ticket=ST-secret');assert.fail();}catch(e){assert.equal(e.host,'other.invalid');assert.match(e.message,/non autorisé/);assert.ok(!e.message.includes('ST-secret'));}
});
test('Domaine parent : trop larges refusés',()=>{
  assert.equal(parentDomain('celcat-auth.univ-reims.fr'),'univ-reims.fr');
  assert.equal(parentDomain('univ-reims.fr'),'univ-reims.fr');
  for(const h of ['fr','com','localhost','a.co.uk','x.gouv.fr','127.0.0.1','[::1]']) assert.equal(parentDomain(h),null,h);
});
const run=(url,env={})=>spawnSync(process.execPath,['server/index.js','--production'],{encoding:'utf8',timeout:4000,env:{PATH:process.env.PATH,PORT:'0',NODE_ENV:'production',SESSION_SECRET:'x'.repeat(40),APP_ORIGIN:'https://edt.example.test',CELCAT_XML_URL:url,...env}});
test('Démarrage : exige seulement un CELCAT_XML_URL HTTPS valide, sans variable CAS',()=>{
  const bad=run('http://celcat.example.test/x.xml');assert.notEqual(bad.status,0);assert.match(bad.stderr,/HTTPS/);
  assert.notEqual(run('pas une url').status,0);
  // Valide : le serveur démarre (arrêt par le délai du test, pas par une erreur de configuration).
  const good=run('https://celcat.example.test/x.xml');assert.ok(!/CELCAT_XML_URL/.test(good.stderr),good.stderr);
  assert.doesNotThrow(()=>checkUpstreamConfig());
});
