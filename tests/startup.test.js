// Démarrage minimal : le module serveur s’importe sans erreur (exports des lib cohérents) et /api/health répond.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
Object.assign(process.env,{NODE_ENV:'production',PORT:'0',SESSION_SECRET:randomBytes(32).toString('base64'),APP_ORIGIN:'https://edt.example.test'});
// TRUSTED_PROXIES facultatif dans la configuration simplifiée.
delete process.env.TRUSTED_PROXIES;
const server=(await import('../server/index.js')).default;
if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
after(()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);}));
test('Le serveur démarre et /api/health répond',async()=>{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
  assert.equal(r.headers.get('cache-control'),'no-store');
});
