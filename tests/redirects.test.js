// Contrôle des redirections CAS/CELCAT : fetch simulé, aucune requête réseau.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
const XML_URL = 'https://celcat-auth.univ-example.fr/xml';
const CAS = 'https://cas.univ-example.fr/cas/login?service=xml';
const XML = '<timetable><event date="2026-09-09"><starttime>14:00</starttime></event></timetable>';
const FORM = '<html><body><form id="fm1" method="post"><input type="hidden" name="execution" value="e1"></form></body></html>';
let lib, routes, calls;
const realFetch = globalThis.fetch;
const redirect = (status, location) => new Response(null, {status, headers: {location}});
before(async () => {
  process.env.CELCAT_XML_URL = XML_URL;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';
    calls.push({url, method, body: init.body ? String(init.body) : '', redirect: init.redirect});
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`requête inattendue : ${method} ${url}`);
    return route();
  };
  lib = await import('../server/lib/celcat-auth.js');
});
after(() => { globalThis.fetch = realFetch; });
const setup = r => { routes = r; calls = []; };

test('Redirection normale vers le CAS du domaine parent : acceptée', async () => {
  setup({
    [`GET ${XML_URL}`]: () => calls.some(c => c.method === 'POST') ? new Response(XML) : redirect(302, CAS),
    [`GET ${CAS}`]: () => new Response(FORM),
    [`POST ${CAS}`]: () => redirect(302, XML_URL),
  });
  const {xml} = await lib.loginAndFetchSchedule('u', 'secret');
  assert.equal(xml, XML);
  assert.ok(calls.every(c => c.redirect === 'manual'));
  // Les identifiants ne partent qu'à l'URL de connexion CAS validée.
  assert.deepEqual(calls.filter(c => c.body.includes('secret')).map(c => c.url), [CAS]);
});

test('Redirection vers un autre domaine : refusée avant tout envoi', async () => {
  setup({[`GET ${XML_URL}`]: () => redirect(302, 'https://cas.evil.example/cas/login')});
  await assert.rejects(lib.loginAndFetchSchedule('u', 'secret'), /non autorisée/);
  assert.equal(calls.length, 1);
});

test('Redirection en HTTP (même domaine) : refusée', async () => {
  setup({[`GET ${XML_URL}`]: () => redirect(302, 'http://cas.univ-example.fr/cas/login')});
  await assert.rejects(lib.loginAndFetchSchedule('u', 'secret'), /non autorisée/);
  assert.equal(calls.length, 1);
});

test('307 après le POST des identifiants : refusé, rien n\'est renvoyé', async () => {
  for (const status of [307, 308]) {
    setup({
      [`GET ${XML_URL}`]: () => redirect(302, CAS),
      [`GET ${CAS}`]: () => new Response(FORM),
      [`POST ${CAS}`]: () => redirect(status, 'https://autre.univ-example.fr/collecte'),
    });
    await assert.rejects(lib.loginAndFetchSchedule('u', 'secret'), /identifiants refusée/);
    assert.equal(calls.filter(c => c.body.includes('secret')).length, 1);
  }
});

test('Plus de 3 redirections : refusé', async () => {
  setup({[`GET ${XML_URL}`]: () => redirect(302, XML_URL)});
  await assert.rejects(lib.fetchScheduleWithExistingSession(JSON.stringify(new CookieJar().toJSON())), /invalide/);
  assert.equal(calls.length, 4);
});
