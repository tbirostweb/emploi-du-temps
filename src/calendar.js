export function isoDate(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function weekDays(reference) {
  const start = new Date(`${reference}T12:00:00`);
  start.setDate(start.getDate() - (start.getDay()+6)%7);
  return Array.from({length:7},(_,i)=>{const day=new Date(start);day.setDate(day.getDate()+i);return isoDate(day);});
}
export function shiftDate(date,days){ const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return isoDate(d); }
export function minutes(time){const [h,m]=time.split(':').map(Number);return h*60+m;}
const formatters=new Map();
export function label(date,options){const key=JSON.stringify(options);if(!formatters.has(key))formatters.set(key,new Intl.DateTimeFormat('fr-FR',options));return formatters.get(key).format(new Date(`${date}T12:00:00`));}

// Le site reste la source du libellé complet ; seule sa présentation est abrégée.
export function shortRoom(value) {
  return String(value ?? '').split('(')[0].trim();
}

const holidayCache = new Map();
// Jours fériés nationaux applicables à Chaumont (hors Alsace-Moselle).
// Référence : https://www.service-public.gouv.fr/particuliers/vosdroits/F2405
export function publicHoliday(date) {
  const year = Number(date?.slice(0, 4));
  if (!Number.isInteger(year) || year < 1583) return '';
  if (!holidayCache.has(year)) {
    // Calcul grégorien de Pâques (Meeus/Jones/Butcher).
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = (h + l - 7 * m + 114) % 31 + 1;
    const easter = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    holidayCache.set(year, new Map([
      [`${year}-01-01`, 'Jour de l’an'],
      [shiftDate(easter, 1), 'Lundi de Pâques'],
      [`${year}-05-01`, 'Fête du Travail'],
      [`${year}-05-08`, 'Victoire de 1945'],
      [shiftDate(easter, 39), 'Ascension'],
      [shiftDate(easter, 50), 'Lundi de Pentecôte'],
      [`${year}-07-14`, 'Fête nationale'],
      [`${year}-08-15`, 'Assomption'],
      [`${year}-11-01`, 'Toussaint'],
      [`${year}-11-11`, 'Armistice'],
      [`${year}-12-25`, 'Noël'],
    ]));
  }
  return holidayCache.get(year).get(date) || '';
}

export function isHolidayCourse(course) {
  if (publicHoliday(course.date)) return true;
  // Certains flux publient le marqueur « Jour férié » comme événement.
  return [course.subject, course.type, course.notes].some(value => {
    const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return /^(?:jour\s+)?ferie(?:s)?(?:\s*[-:–(]|$)/i.test(text);
  });
}

export function teachingHours(courses) {
  const total = courses.reduce((sum, course) => {
    if (isHolidayCourse(course)) return sum;
    const duration = minutes(course.end || course.start) - minutes(course.start);
    return sum + (Number.isFinite(duration) ? Math.max(0, duration) : 0);
  }, 0);
  return Math.round(total / 60 * 10) / 10;
}
