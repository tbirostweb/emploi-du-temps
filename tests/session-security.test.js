// F2/F7/F8 : contrôles unitaires de session et du jar sérialisé.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EncryptJWT} from 'jose';
import {CookieJar} from 'tough-cookie';
process.env.SESSION_SECRET='test-only-secret-abcdefghijklmnopqrstuvwxyz';
process.env.SESSION_MAX_PER_USER='3';
process.env.CELCAT_XML_URL='https://celcat-auth.example.test/groupes/flux.xml';
const {createSessionToken,readSessionToken,decryptSessionToken,activeSessionCount}=await import('../server/lib/session.js');
const {serializeCelcatJar}=await import('../server/lib/celcat-auth.js');

test('F7 : JWE PBES2 forgé refusé (algorithme hors liste, aucune dérivation)',async()=>{
  // Même avec le bon secret comme mot de passe, seul dir/A256GCM est accepté.
  const password=createHash('sha256').update(process.env.SESSION_SECRET).digest();
  const forged=await new EncryptJWT({jar:'{}'}).setProtectedHeader({alg:'PBES2-HS256+A128KW',enc:'A256GCM',p2c:1000}).setJti('x').setExpirationTime('1h').encrypt(password);
  assert.equal(await decryptSessionToken(forged),null);
  assert.equal(await readSessionToken(forged),null);
  const ok=await createSessionToken('{}');
  assert.ok((await decryptSessionToken(ok))?.jti);
});
test('F8 : jeton trop volumineux refusé sans entrée orpheline',async()=>{
  const before=activeSessionCount();
  await assert.rejects(createSessionToken('x'.repeat(5000)),/trop volumineuse/);
  assert.equal(activeSessionCount(),before);
});
test('F8 : sessions plafonnées par utilisateur (la plus ancienne évincée)',async()=>{
  const tokens=[];
  for(let i=0;i<4;i++) tokens.push(await createSessionToken('{}',{username:i%2?'Alice':' alice'}));
  assert.equal(await readSessionToken(tokens[0]),null);
  for(const t of tokens.slice(1)) assert.equal(await readSessionToken(t),'{}');
  // Un autre utilisateur n’est pas affecté.
  assert.equal(await readSessionToken(await createSessionToken('{}',{username:'bob'})),'{}');
});
test('F2 : le jar sérialisé ne contient aucun cookie du domaine CAS',()=>{
  const jar=new CookieJar();
  jar.setCookieSync('TGC=secret; Path=/cas; Secure','https://cas.example.test/cas/login');
  jar.setCookieSync('SSO=parent; Domain=example.test; Path=/; Secure','https://cas.example.test/cas/login');
  jar.setCookieSync('JSESSIONID=celcat; Path=/; Secure','https://celcat-auth.example.test/groupes/flux.xml');
  const serialized=serializeCelcatJar(jar);
  const names=JSON.parse(serialized).cookies.map(c=>c.key);
  assert.deepEqual(names,['JSESSIONID']);
  assert.ok(!serialized.includes('cas.example.test'));assert.ok(!serialized.includes('secret'));
  // Le jar reconstruit renvoie bien le cookie CELCAT.
  assert.equal(CookieJar.fromJSON(serialized).getCookieStringSync('https://celcat-auth.example.test/groupes/flux.xml'),'JSESSIONID=celcat');
});
