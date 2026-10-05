import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { page, legalPage, privacyPage } from './pages.js';
import { fileURLToPath } from 'node:url';
import { checkUpstreamConfig, loginAndFetchSchedule, fetchScheduleWithExistingSession, CelcatAuthError, UpstreamPolicyError } from './lib/celcat-auth.js';
import { createSessionToken, readSessionToken, revokeSessionToken, SESSION_MAX_AGE_SECONDS } from './lib/session.js';
import { parseCelcatXml } from './lib/parse-xml.js';

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('change-moi'))) throw new Error('Configure SESSION_SECRET avec une clé aléatoire d’au moins 32 caractères.');
const app = express();
app.disable('x-powered-by');
// Compresser les ressources publiques ; ne pas compresser les réponses privées.
app.use(compression({filter:(req,res)=>!req.path.startsWith('/api/') && compression.filter(req,res)}));
// Adresses/CIDR explicites du proxy Traefik, jamais `true` ou un nombre de sauts.
if (process.env.TRUSTED_PROXIES) app.set('trust proxy', process.env.TRUSTED_PROXIES.split(',').map(v=>v.trim()).filter(Boolean));
app.use(helmet({
  contentSecurityPolicy: production ? { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"], connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
  }} : false,
  strictTransportSecurity: production ? { maxAge: 31536000 } : false,
}));
app.use((_req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow');res.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');next();});
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Trop de tentatives. Réessaie dans 15 minutes.'}});
const scheduleLimiter=rateLimit({windowMs:60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Trop d’actualisations. Réessaie dans une minute.'}});
if(production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN est requis en production (https://ton-domaine).');
const origin=process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
if(production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN doit utiliser HTTPS.');
// Hôte(s) CAS exact(s) vers lesquels les identifiants peuvent être soumis (aucune valeur par défaut devinée).
// Démarrage : CELCAT_XML_URL doit être une URL HTTPS valide ; les hôtes autorisés en sont dérivés.
if(production) checkUpstreamConfig();
app.use('/api', (req,res,next) => {
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  // Comme à l’origine : si l’en-tête Origin est présent il doit correspondre à APP_ORIGIN ; les requêtes cross-site sont refusées.
  if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' || (origin && req.headers.origin && req.headers.origin !== origin) )) return res.status(403).json({error:'Requête non autorisée.'});
  next();
});
app.use(express.json({limit:'8kb'}));
const readCookie = req => req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('edt_session='))?.slice(12);
const cookie = (res, value, maxAge = SESSION_MAX_AGE_SECONDS*1000) => res.cookie('edt_session',value,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge});
const schedule = xml => {
  const courses = parseCelcatXml(xml);
  return {courses,fetchedAt:new Date().toISOString(),dayCount:new Set(courses.map(c=>c.date)).size};
};
app.get('/api/health', (_req,res)=>res.json({ok:true}));
app.post('/api/auth/login', loginLimiter, async (req,res,next)=>{
  const {username,password} = req.body || {};
  if(typeof username!=='string'||typeof password!=='string'||!username.trim()||!password||username.length>200||password.length>1000) return res.status(400).json({error:'Renseigne ton identifiant et ton mot de passe.'});
  try {
    const {xml,serializedJar} = await loginAndFetchSchedule(username.trim(),password);
    const data=schedule(xml);
    const token=await createSessionToken(serializedJar);
    if(token.length>3800) throw new Error('Session trop volumineuse');
    cookie(res,token);res.json(data);
  } catch(error){next(error);}
});
app.post('/api/auth/logout',async(req,res,next)=>{try{await revokeSessionToken(readCookie(req));cookie(res,'',0);res.json({ok:true});}catch(error){next(error);}});
app.get('/api/edt',scheduleLimiter,async(req,res,next)=>{
  try {
    const token=readCookie(req);
    const jar=await readSessionToken(token);
    const xml=jar?await fetchScheduleWithExistingSession(jar):null;
    if(!xml){await revokeSessionToken(token);cookie(res,'',0);return res.status(401).json({error:'Ta session a expiré. Reconnecte-toi pour retrouver tes cours.',code:'SESSION_EXPIRED'});}
    if(!production && req.query.debug==='1') return res.type('application/xml').send(xml);
    res.json(schedule(xml));
  }catch(error){next(error);}
});
app.use('/api',(_req,res)=>res.status(404).json({error:'Page introuvable.'}));
app.get('/mentions-legales',(_req,res)=>res.type('html').send(legalPage()));
app.get('/confidentialite',(_req,res)=>res.type('html').send(privacyPage()));
if(production){
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));
  app.use('/assets',express.static(`${dist}/assets`,{maxAge:'1y',immutable:true}));
  app.use(express.static(dist,{setHeaders:res=>res.set('Cache-Control','no-cache')}));
  app.get('/',(_req,res)=>res.sendFile(`${dist}/index.html`));
  app.use((_req,res)=>res.status(404).type('html').send(page('Page introuvable', '<p>Cette page n’existe pas ou a été déplacée.</p><p><a href="/">Retrouver mon emploi du temps</a></p>')));
}else{
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
  app.use(vite.middlewares);
}
app.use((error,_req,res,_next)=>{
  const status=error instanceof CelcatAuthError?401:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:502;
  // Diagnostic minimal : aucun message d’exception ni contenu de requête.
  if(status>=500){
    const host=error instanceof UpstreamPolicyError?error.host:undefined;
    process.stderr.write(JSON.stringify({event:error instanceof UpstreamPolicyError?'upstream_refused':'request_failed',status,...(host?{message:`hôte de redirection non autorisé : ${host} — hors du domaine de CELCAT_XML_URL`}:{}),at:new Date().toISOString()})+'\n');
  }
  res.status(status).json({error:status===401?'Connexion impossible. Vérifie tes identifiants ou réessaie plus tard.':status===400?'Requête invalide.':status===413?'Requête trop volumineuse.':'Service temporairement indisponible. Réessaie dans un instant.'});
});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{if(!production) process.stdout.write(`Emploi du temps : http://localhost:${process.env.PORT||3000}\n`);});
const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
export default server;
