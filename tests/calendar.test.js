import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDays, shiftDate } from '../src/calendar.js';
import { parseCelcatXml } from '../server/lib/parse-xml.js';
import {createSessionToken,readSessionToken} from '../server/lib/session.js';
const event=(id,day,mask='YYN')=>`<event id="${id}" date="07/09/2026 - 21/09/2026"><day>${day}</day><rawweeks>${mask}</rawweeks><starttime>08:30:00</starttime><endtime>10:30</endtime><resources><module><item>Sciences de l’éducation</item></module><room><item>A12</item><item>A13</item></room><staff><item>Enseignant</item></staff></resources></event>`;
const spans='<span date="07/09/2026" rawix="1"><alleventweeks>YNN</alleventweeks></span><span date="14/09/2026" rawix="2"><alleventweeks>NYN</alleventweeks></span><span date="21/09/2026" rawix="3"><alleventweeks>NNY</alleventweeks></span>';
test('CELCAT : chaque jour et chaque semaine active produit une occurrence',()=>{
 const courses=parseCelcatXml(`<timetable>${spans}${event('a',0)}${event('b',1)}${event('c',6)}</timetable>`);
 assert.deepEqual(courses.map(c=>c.date),['2026-09-07','2026-09-08','2026-09-13','2026-09-14','2026-09-15','2026-09-20']);
 assert.equal(new Set(courses.map(c=>c.id)).size,6);
 assert.equal(courses[0].subject,'Sciences de l’éducation');assert.deepEqual(courses[0].rooms,['A12','A13']);assert.equal(courses[0].start,'08:30');
});
test('La date de période de l’événement ne remplace pas le jour réel',()=>{
 const c=parseCelcatXml(`<timetable>${spans}${event('b',3,'NYN')}</timetable>`);assert.equal(c[0].date,'2026-09-17');assert.equal(c.length,1);
});
test('Dates explicites : attribut, balise, ISO et français',()=>{
 const c=parseCelcatXml('<timetable><event id="1" date="08/09/2026"><starttime>09:00</starttime></event><event id="2"><date>2026-09-09</date><starttime>10:00</starttime></event></timetable>');assert.deepEqual(c.map(c=>c.date),['2026-09-08','2026-09-09']);
});
test('Une semaine qui traverse le changement d’année contient sept jours',()=>{
 assert.deepEqual(weekDays('2027-01-01'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.equal(shiftDate('2026-10-25',7),'2026-11-01');
});
test('Un XML invalide ou des semaines indécodables produisent une erreur',()=>{
 assert.throws(()=>parseCelcatXml('<timetable><event></timetable>'));
 assert.throws(()=>parseCelcatXml(`<timetable>${event('a',0)}</timetable>`));
});
test('Session : chiffrée, lisible et protégée contre une altération',async()=>{
 process.env.SESSION_SECRET='test-only-secret-abcdefghijklmnopqrstuvwxyz';const value='{"cookies":[]}';const token=await createSessionToken(value);assert.equal(await readSessionToken(token),value);assert.equal(await readSessionToken(`${token}x`),null);assert.equal(await readSessionToken(null),null);assert.ok(!token.includes(value));
});
test('Flux hostile : entités personnalisées et volume d’occurrences plafonnés',()=>{
 assert.throws(()=>parseCelcatXml('<!DOCTYPE t [<!ENTITY a "b">]><timetable><event date="08/09/2026"><starttime>09:00</starttime><module>&a;</module></event></timetable>'),/invalide/);
 assert.throws(()=>parseCelcatXml(`<timetable>${spans}${event('a',0,'Y'.repeat(30000))}</timetable>`),/trop/);
 assert.equal(parseCelcatXml('<timetable><event date="08/09/2026"><starttime>09:00</starttime><module>&lt;img src=x onerror=alert(1)&gt;</module></event></timetable>')[0].subject,'<img src=x onerror=alert(1)>');
});
test('Session : jeton révoqué refusé, jeton d’une autre clé refusé',async()=>{
 const {revokeSessionToken}=await import('../server/lib/session.js');
 process.env.SESSION_SECRET='test-only-secret-abcdefghijklmnopqrstuvwxyz';const token=await createSessionToken('{}');
 assert.equal(await readSessionToken(token),'{}');await revokeSessionToken(token);assert.equal(await readSessionToken(token),null);
 const other=await createSessionToken('{}');process.env.SESSION_SECRET='another-test-secret-abcdefghijklmnopqrstuv';assert.equal(await readSessionToken(other),null);
});
