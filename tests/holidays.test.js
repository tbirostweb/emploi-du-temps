import test from 'node:test';
import assert from 'node:assert/strict';
import { publicHoliday, isHolidayCourse, teachingHours } from '../src/calendar.js';

test('Les onze jours fériés nationaux 2026 correspondent au calendrier officiel', () => {
  for (const date of ['01-01','04-06','05-01','05-08','05-14','05-25','07-14','08-15','11-01','11-11','12-25']) {
    assert.ok(publicHoliday(`2026-${date}`), date);
  }
  assert.equal(publicHoliday('2026-04-03'), ''); // Vendredi saint : pas férié à Chaumont.
  assert.equal(publicHoliday('2026-12-26'), '');
  assert.equal(publicHoliday('2027-03-29'), 'Lundi de Pâques');
  assert.equal(publicHoliday('2027-05-06'), 'Ascension');
  assert.equal(publicHoliday('2027-05-17'), 'Lundi de Pentecôte');
});

test('Un jour férié reste dans les données mais ne gonfle pas les heures', () => {
  const courses = [
    {date:'2026-11-10', start:'08:30', end:'10:00', subject:'Maths'},
    {date:'2026-11-11', start:'08:00', end:'18:00', subject:'Armistice'},
    {date:'2026-11-12', start:'13:30', end:'15:00', subject:'Français'},
  ];
  assert.equal(teachingHours(courses), 3);
  assert.equal(courses.length, 3);
  assert.equal(teachingHours([courses[1]]), 0);
});

test('Les marqueurs CELCAT sont exclus, sans confondre avec un sujet de cours', () => {
  assert.equal(isHolidayCourse({date:'2026-09-09',subject:'Jour férié'}),true);
  assert.equal(isHolidayCourse({date:'2026-09-09',subject:'Cours',notes:'JOUR FERIE - fermeture'}),true);
  assert.equal(isHolidayCourse({date:'2026-09-09',subject:'Histoire des jours fériés'}),false);
  assert.equal(teachingHours([{date:'2026-09-09',start:'08:00',end:'18:00',type:'Férié'}]),0);
});
