<script setup>
import { parseCelcatXml } from '../server/lib/parse-xml.js';
import { computed, onUnmounted, ref } from 'vue';
import { Leaf, Sun, Moon, LogOut, ArrowRight, RefreshCw, CalendarDays, CalendarCheck, Clock3, ChevronLeft, ChevronRight, Cloud, Plus, Minus } from '@lucide/vue';
import forestBanner from './assets/forest-banner.webp';
import cherryBlossoms from './assets/cherry-blossoms.svg';
import forestMobile from './assets/forest-mobile.webp';
import CourseCard from './components/CourseCard.vue';
import { isoDate,weekDays,shiftDate,minutes,label,teachingHours } from './calendar.js';
const today=isoDate(new Date()), reference=ref(today), selected=ref(today);
const courses=ref([]), authenticated=ref(false), loading=ref(false), error=ref(''), fetchedAt=ref('');
const viewport=window.matchMedia('(max-width: 700px)');
const compact=ref(viewport.matches), chosenMode=ref(null);
const mode=computed({get:()=>chosenMode.value ?? (compact.value?'day':'week'),set:value=>{chosenMode.value=value;}});
const dark=ref(true), weekend=ref(false);
function resize(event){compact.value=event.matches;}
viewport.addEventListener('change',resize);
onUnmounted(()=>viewport.removeEventListener('change',resize));
try {dark.value=localStorage.getItem('edt-theme-v2')!=='light';}catch{}
const days=computed(()=>weekDays(reference.value));
const weekCourses=computed(()=>courses.value.filter(c=>days.value.includes(c.date)));
const countDays=computed(()=>new Set(courses.value.map(c=>c.date)).size);
const hours=computed(()=>teachingHours(weekCourses.value));
const range=computed(()=>`${label(days.value[0],{day:'numeric',month:'long'})} – ${label(days.value[6],{day:'numeric',month:'long',year:'numeric'})}`);
const hasWeekend=computed(()=>weekCourses.value.some(c=>days.value.slice(5).includes(c.date)));
const shownDays=computed(()=>mode.value==='day'?[selected.value]:weekend.value||hasWeekend.value?days.value:days.value.slice(0,5));
const periods=[{id:'morning',label:'Matin',start:0,end:720},{id:'afternoon',label:'Après-midi',start:720,end:1440}];
const groupedCourses=computed(()=>{
  const groups=new Map(days.value.map(day=>[day,{all:[],morning:[],afternoon:[]}]));
  for(const course of weekCourses.value){const group=groups.get(course.date);group.all.push(course);group[minutes(course.start)<720?'morning':'afternoon'].push(course);}
  return groups;
});
function periodCourses(day,period){return groupedCourses.value.get(day)?.[period.id]||[];}
function dayCourses(day){return groupedCourses.value.get(day)?.all||[];}
function navigate(n){reference.value=shiftDate(reference.value,n*7);selected.value=shiftDate(selected.value,n*7);}
function goToday(){reference.value=today;selected.value=today;}
function jump(event){if(event.target.value){reference.value=event.target.value;selected.value=event.target.value;}}
function toggleTheme(){dark.value=!dark.value;try{localStorage.setItem('edt-theme-v2',dark.value?'dark':'light');}catch{}}
async function importXml(event) {
 error.value=''; const file=event.target.files?.[0]; if(!file)return;
 if(file.size>2*1024*1024){error.value='Le fichier doit faire moins de 2 Mo.';return;}
 try {courses.value=parseCelcatXml(await file.text()).map(c=>({...c,staff:[],team:[],notes:''}));fetchedAt.value=new Date().toISOString();authenticated.value=true;}
 catch {error.value='Ce fichier XML n’est pas un export CELCAT valide.';}
 event.target.value='';
}
function load(){error.value='Pour actualiser, ferme le planning puis importe un export XML récent.';}
function logout(){authenticated.value=false;courses.value=[];error.value='';}
</script>

<template>
  <div class="app" :class="{dark}">
    <header class="topbar">
      <a class="brand" href="/"><span class="brand-icon" aria-hidden="true"><Leaf /></span><span>Mon emploi du temps<small>INSPÉ · Université de Reims</small></span></a>
      <div class="header-actions"><span class="semester">Année universitaire {{Number(today.slice(5,7))>=8?Number(today.slice(0,4)):Number(today.slice(0,4))-1}}–{{Number(today.slice(5,7))>=8?Number(today.slice(0,4))+1:Number(today.slice(0,4))}}</span><button class="icon-button" @click="toggleTheme" :aria-label="dark?'Activer le thème clair':'Activer le thème sombre'"><Sun v-if="dark" aria-hidden="true" /><Moon v-else aria-hidden="true" /></button><button v-if="authenticated" class="text-button logout-button" aria-label="Se déconnecter" title="Se déconnecter" :disabled="loading" @click="logout"><LogOut aria-hidden="true" /><span>Se déconnecter</span></button></div>
    </header>

    <main v-if="!authenticated" class="login-layout">
      <div v-if="!compact" class="login-intro"><div class="login-landscape" aria-hidden="true"></div><div class="login-intro-copy"><div class="eyebrow">INSPÉ · CHAUMONT</div><h1>Une place pour<br><em>ta semaine.</em></h1><p>Les cours, les salles, les horaires.<br>Ton quotidien étudiant, simplement.</p><span class="intro-caption">Mon emploi du temps · Université de Reims</span></div></div>
      <section class="login-card"><img class="cherry-decoration cherry-login" :src="cherryBlossoms" width="360" height="240" alt="" aria-hidden="true" draggable="false"><span class="eyebrow">TON ESPACE ÉTUDIANT</span><h2>Bienvenue <em>à toi.</em></h2><p>Ouvre ton export XML CELCAT obtenu directement auprès de l’université.</p><label for="planning-file">Importer mon planning XML</label><input id="planning-file" type="file" accept=".xml,application/xml,text/xml" @change="importXml"><p v-if="error" role="alert" class="error">{{error}}</p><p class="privacy">Le fichier est lu uniquement dans ce navigateur, sans envoi au serveur. Aucun identifiant universitaire n’est demandé. Fermer la page efface le planning.</p></section>
    </main>

    <main v-else class="workspace">
      <div class="forest-banner"><img class="cherry-decoration cherry-banner" :src="cherryBlossoms" width="360" height="240" alt="" aria-hidden="true" draggable="false"><picture class="forest-picture"><source media="(max-width: 700px)" :srcset="forestMobile"><img :src="forestBanner" width="1440" height="420" alt="" decoding="async" fetchpriority="high"></picture><div class="banner-copy"><span class="eyebrow">TON ESPACE ÉTUDIANT</span><p>Chaque chose<br><em>en son temps.</em></p></div><span class="banner-stamp">INSPÉ<br>CHAUMONT</span></div>
      <div class="page-heading"><div><div class="eyebrow">INSPÉ · CHAUMONT</div><h1>Ma <em>{{mode==='day'?'journée.':'semaine.'}}</em></h1><p class="muted">Ton emploi du temps, en un regard.</p></div><button class="refresh" aria-label="Actualiser l’emploi du temps" :disabled="loading" @click="load()"><RefreshCw aria-hidden="true" :class="{spinning:loading}" /> {{loading?'Actualisation…':'Actualiser'}}</button></div>
      <div v-if="error" class="error" role="alert">{{error}}</div>
      <section class="summary" aria-label="Résumé de la semaine"><div><span class="stat-icon" aria-hidden="true"><CalendarDays /></span><span><strong>{{weekCourses.length}}</strong><small>cours cette semaine</small></span></div><div><span class="stat-icon" aria-hidden="true"><Clock3 /></span><span><strong>{{hours.toLocaleString('fr-FR')}} h</strong><small>de cours · hors jours fériés</small></span></div><div class="sync"><span class="sync-dot"></span><span>Synchronisé avec CELCAT<small>Mis à jour à {{fetchedAt?new Date(fetchedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}}</small></span></div></section>
      <section class="calendar-shell" :aria-busy="loading">
        <div class="calendar-toolbar"><div class="date-navigation"><button class="icon-button" aria-label="Semaine précédente" @click="navigate(-1)"><ChevronLeft aria-hidden="true" /></button><button class="icon-button" aria-label="Semaine suivante" @click="navigate(1)"><ChevronRight aria-hidden="true" /></button><h2>{{range}}</h2></div><div class="view-actions"><button v-if="mode==='week' && !hasWeekend" class="weekend-toggle" :aria-pressed="weekend" @click="weekend=!weekend"><Minus v-if="weekend" aria-hidden="true" /><Plus v-else aria-hidden="true" />{{weekend?'Masquer le week-end':'Week-end'}}</button><button @click="goToday"><CalendarCheck aria-hidden="true" />Aujourd’hui</button><label class="date-picker">Aller au<input aria-label="Aller à une date" type="date" :value="reference" @change="jump"></label><div class="segmented" aria-label="Affichage"><button :class="{active:mode==='week'}" :aria-pressed="mode==='week'" @click="mode='week'">Semaine</button><button :class="{active:mode==='day'}" :aria-pressed="mode==='day'" @click="mode='day'">Jour</button></div></div></div>
        <div v-if="mode==='day'" class="day-tabs" aria-label="Choisir un jour"><button v-for="day in days" :key="day" :class="{active:day===selected}" :aria-pressed="day===selected" :aria-label="label(day,{weekday:'long',day:'numeric',month:'long'})+', '+dayCourses(day).length+' cours'" @click="selected=day"><span>{{label(day,{weekday:'short'})}}</span><strong>{{label(day,{day:'numeric'})}}</strong><small>{{dayCourses(day).length}}<span class="course-count-label"> cours</span></small></button></div>
        <div v-if="!weekCourses.length" class="empty-week"><Cloud class="empty-icon" aria-hidden="true" /><h3>Aucun cours cette semaine</h3><p>{{courses.length?'Consulte une autre semaine pour retrouver tes cours.':'Le fichier ne contient aucun cours exploitable.'}}</p><button v-if="courses.length" @click="reference=courses[0].date;selected=courses[0].date">Voir la première semaine disponible <ArrowRight aria-hidden="true" /></button></div>
        <div v-else class="calendar-scroll" :tabindex="compact?-1:0" aria-label="Planning des cours">
          <div class="week-grid" :class="{'day-view':mode==='day'}" :style="{'--day-count':shownDays.length}">
            <section v-for="day in shownDays" :key="day" class="day-column" :class="{'is-today':day===today}">
              <header class="day-heading"><div><span>{{label(day,{weekday:'long'})}}</span><small>{{day===today?'Aujourd’hui':`${dayCourses(day).length} cours`}}</small><strong>{{label(day,{day:'2-digit'})}}</strong></div></header>
              <div class="day-content">
                <section v-for="period in periods" :key="period.id" class="period"><h3 class="period-heading">{{period.label}}<span>{{periodCourses(day,period).length||'—'}}</span></h3>
                  <CourseCard v-for="course in periodCourses(day,period)" :key="course.id" :course="course" />
                  <p v-if="!periodCourses(day,period).length" class="free-period">Aucun cours</p>
                </section>
              </div>
            </section>
          </div>
        </div>
        <footer class="calendar-footer"><span><i class="legend green"></i> Cours <i class="legend blue"></i> TD <i class="legend rose"></i> TP</span><span>{{countDays}} jours disponibles dans ton agenda</span></footer>
      </section><p class="footnote">Un changement de salle ? Actualise l’agenda avant de partir.</p>
    </main>
    <footer class="site-footer"><a href="/mentions-legales">Mentions légales</a><a href="/confidentialite">Confidentialité</a></footer>
  </div>
</template>
