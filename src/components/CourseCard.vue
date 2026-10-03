<script setup>
import { computed } from 'vue';
import { MapPin, ChevronDown } from '@lucide/vue';
import { shortRoom, isHolidayCourse } from '../calendar.js';
const props=defineProps({course:{type:Object,required:true}});
const tone=computed(()=>{const type=(props.course.type||'').toLowerCase();return type.includes('td')?'blue':type.includes('tp')?'rose':'green';});
const holiday=computed(()=>isHolidayCourse(props.course));
const rooms=computed(()=>[...new Set(props.course.rooms.map(shortRoom).filter(Boolean))]);
</script>
<template>
  <article class="course" :class="tone">
    <div class="course-top"><span>{{course.type||'Cours'}}</span><span class="course-duration" v-if="course.end">{{course.start}}–{{course.end}}</span></div>
    <h3>{{course.subject}}</h3>
    <p v-if="holiday" class="holiday-note">Jour férié · hors total d’heures</p>
    <p v-if="!course.end" class="course-time">À {{course.start}}</p>
    <div class="course-meta"><p v-if="rooms.length" class="course-room"><MapPin aria-hidden="true" /><span>{{rooms.join(' · ')}}</span></p><p v-if="course.staff.length" class="course-staff">{{course.staff.join(', ')}}</p></div>
    <details v-if="course.notes||course.group||course.teams.length"><summary><span>Informations du cours</span><ChevronDown aria-hidden="true" /></summary><p v-if="course.group">{{course.group}}</p><p v-if="course.teams.length">{{course.teams.join(', ')}}</p><p v-if="course.notes">{{course.notes}}</p></details>
  </article>
</template>
