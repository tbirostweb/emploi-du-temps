import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { page, legalPage, privacyPage } from './pages.js';
import { fileURLToPath } from 'node:url';
import { loginAndFetchSchedule, fetchScheduleWithExistingSession, CelcatAuthError } from './lib/celcat-auth.js';
import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSessionToken, readSessionToken, SESSION_COOKIE_NAME, sessionCookieOptions } from './lib/session.js';
import { parseCelcatXml } from './lib/parse-xml.js';

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('change-moi'))) throw new Error('Configure SESSION_SECRET avec une clé aléatoire d’au moins 32 caractères.');
const app = express();
app.disable('x-powered-by');
// Compresser les ressources publiques ; ne pas compresser les réponses privées.
app.use(compression({filter:(req,res)=>!req.path.startsWith('/api/') && compression.filter(req,res)}));
// Adresses/CIDR explicites du proxy Traefik, jamais `true` ou un nombre de sauts.
// Vide = en-têtes proxy ignorés (voir .env.example).
if (process.env.TRUSTED_PROXIES) app.set('trust proxy', process.env.TRUSTED_PROXIES.split(',').map(v=>v.trim()).filter(Boolean));
app.use(helmet({
  contentSecurityPolicy: production ? { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    fontSrc: ["'self'"], connectSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"],
  }} : false,
  strictTransportSecurity: production ? { maxAge: 31536000 } : false,
}));
app.use((_req,res,next)=>{res.set('X-Robots-Tag','noindex, nofollow');res.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');next();});
// Seuls les échecs comptent (skipSuccessfulRequests) : une connexion réussie ne consomme pas le quota.
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,skipSuccessfulRequests:true,
  message:{error:'Trop de tentatives. Réessaie dans 15 minutes.'}});
// Anti password spraying : échecs par identifiant normalisé (toutes IP confondues) et plafond global.
const normalizedUsername=req=>typeof req.body?.username==='string'?req.body.username.normalize('NFKC').trim().toLowerCase():'';
const usernameLoginLimiter=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,skipSuccessfulRequests:true,
  skip:req=>!normalizedUsername(req),
  // Empreinte : l’identifiant en clair n’est pas conservé dans le compteur.
  keyGenerator:req=>'u:'+createHash('sha256').update(normalizedUsername(req)).digest('base64url'),
  message:{error:'Trop de tentatives. Réessaie dans une heure.'}});
const globalLoginLimiter=rateLimit({windowMs:60*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,skipSuccessfulRequests:true,
  keyGenerator:()=>'global',
  message:{error:'Trop de tentatives. Réessaie plus tard.'}});
const logoutLimiter=rateLimit({windowMs:60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Trop de requêtes. Réessaie dans une minute.'}});
// Compteur des échecs de connexion depuis le démarrage (journal sans identifiant ni IP ; reason = étape CAS en échec).
let loginFailures=0;
const scheduleLimiter=rateLimit({windowMs:60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Trop d’actualisations. Réessaie dans une minute.'}});
if(production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN est requis en production (https://ton-domaine).');
const origin=process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
if(production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN doit utiliser HTTPS.');
app.use('/api', (req,res,next) => {
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  // Comme à l’origine : si l’en-tête Origin est présent il doit correspondre à APP_ORIGIN ; les requêtes cross-site sont refusées.
  if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' || (origin && req.headers.origin && req.headers.origin !== origin) )) return res.status(403).json({error:'Requête non autorisée.'});
  next();
});
app.use(express.json({limit:'8kb'}));
const readCookie = req => req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE_NAME}=`))?.slice(SESSION_COOKIE_NAME.length+1);
// sessionCookieOptions.maxAge est en secondes ; Express attend des millisecondes. Secure seulement en production (développement local en HTTP).
const cookie = (res, value, maxAge = sessionCookieOptions.maxAge*1000) => res.cookie(SESSION_COOKIE_NAME,value,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge});
const schedule = xml => {
  const courses = parseCelcatXml(xml);
  return {courses,fetchedAt:new Date().toISOString(),dayCount:new Set(courses.map(c=>c.date)).size};
};
app.get('/api/health', (_req,res)=>res.json({ok:true}));
// Thème du site, choisi pour tout le monde depuis les IP de THEME_ADMIN_IPS (adresses ou CIDR).
const THEMES=['foret','noel'];
const themeFile=process.env.THEME_FILE||fileURLToPath(new URL('../data/theme.json',import.meta.url));
let siteTheme='foret';
try{const saved=JSON.parse(readFileSync(themeFile,'utf8')).theme;if(THEMES.includes(saved))siteTheme=saved;}catch{}
const themeAdmins=new BlockList();
for(const entry of (process.env.THEME_ADMIN_IPS||'').split(',').map(v=>v.trim()).filter(Boolean)){
  const [address,prefix]=entry.split('/');const family=isIP(address)===6?'ipv6':'ipv4';
  if(!isIP(address)) throw new Error(`THEME_ADMIN_IPS : adresse invalide « ${entry} ».`);
  prefix?themeAdmins.addSubnet(address,Number(prefix),family):themeAdmins.addAddress(address,family);
}
const clientIp=req=>(req.ip||'').replace(/^::ffff:(?=\d+\.)/,'');
const isThemeAdmin=req=>{const ip=clientIp(req);return isIP(ip)>0&&themeAdmins.check(ip,isIP(ip)===6?'ipv6':'ipv4');};
const themeLimiter=rateLimit({windowMs:60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:'Trop de requêtes. Réessaie dans une minute.'}});
// `ip` : l’adresse du visiteur vue par le serveur (la sienne seulement), pour régler THEME_ADMIN_IPS.
app.get('/api/theme',(req,res)=>res.json({theme:siteTheme,admin:isThemeAdmin(req),ip:clientIp(req)}));
app.post('/api/theme',themeLimiter,async(req,res)=>{
  if(!isThemeAdmin(req)) return res.status(403).json({error:'Requête non autorisée.'});
  const theme=req.body?.theme;
  if(!THEMES.includes(theme)) return res.status(400).json({error:'Thème inconnu.'});
  siteTheme=theme;
  // Sans volume persistant, le choix tient jusqu’au prochain redémarrage.
  try{await mkdir(dirname(themeFile),{recursive:true});await writeFile(themeFile,JSON.stringify({theme}));}catch{process.stderr.write(JSON.stringify({event:'theme_save_failed',at:new Date().toISOString()})+'\n');}
  res.json({theme});
});
// Ordre : un refus 429 d’un limiteur amont ne consomme pas les quotas suivants (dont le global).
app.post('/api/auth/login', loginLimiter, usernameLoginLimiter, globalLoginLimiter, async (req,res,next)=>{
  const {username,password} = req.body || {};
  if(typeof username!=='string'||typeof password!=='string'||!username.trim()||!password||username.length>200||password.length>1000) return res.status(400).json({error:'Renseigne ton identifiant et ton mot de passe.'});
  try {
    const {xml,serializedJar} = await loginAndFetchSchedule(username.trim(),password);
    const data=schedule(xml);
    const token=await createSessionToken(serializedJar);
    if(token.length>4000) process.stderr.write(JSON.stringify({event:'session_cookie_too_large',bytes:token.length,at:new Date().toISOString()})+'\n');
    cookie(res,token);res.json(data);
  } catch(error){
    if(error instanceof CelcatAuthError) process.stderr.write(JSON.stringify({event:'login_failed',reason:error.message,count:++loginFailures,at:new Date().toISOString(),...(!production&&error.detail?{detail:error.detail}:{})})+'\n');
    next(error);
  }
});
// Déconnexion : suppression du cookie dans le navigateur (aucun registre serveur des sessions).
app.post('/api/auth/logout',logoutLimiter,(_req,res)=>{cookie(res,'',0);res.json({ok:true});});
app.get('/api/edt',scheduleLimiter,async(req,res,next)=>{
  try {
    const token=readCookie(req);
    const jar=await readSessionToken(token);
    const result=jar?await fetchScheduleWithExistingSession(jar):null;
    if(!result){cookie(res,'',0);return res.status(401).json({error:'Ta session a expiré. Reconnecte-toi pour retrouver tes cours.',code:'SESSION_EXPIRED'});}
    // Jar éventuellement renouvelé (SSO CAS) : le cookie est réécrit, ce qui prolonge la session.
    cookie(res,await createSessionToken(result.serializedJar));
    if(!production && req.query.debug==='1') return res.type('application/xml').send(result.xml);
    res.json(schedule(result.xml));
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
  if(status>=500) process.stderr.write(JSON.stringify({event:'request_failed',status,at:new Date().toISOString()})+'\n');
  res.status(status).json({error:status===401?'Connexion impossible. Vérifie tes identifiants ou réessaie plus tard.':status===400?'Requête invalide.':status===413?'Requête trop volumineuse.':'Service temporairement indisponible. Réessaie dans un instant.'});
});
const server=app.listen(Number(process.env.PORT||3000),production?'0.0.0.0':'127.0.0.1',()=>{if(!production) process.stdout.write(`Emploi du temps : http://localhost:${process.env.PORT||3000}\n`);});
const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
export default server;
