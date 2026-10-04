import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { page, legalPage, privacyPage } from './pages.js';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
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
if(production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN est requis en production (https://ton-domaine).');
const origin=process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
if(production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN doit utiliser HTTPS.');
app.use('/api', (req,res,next) => {
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  // En production, tout POST doit porter l’Origin attendue (les navigateurs l’envoient sur fetch POST).
  if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' || (origin && req.headers.origin && req.headers.origin !== origin) || (production && req.headers.origin !== origin))) return res.status(403).json({error:'Requête non autorisée.'});
  next();
});
// Relais CAS/CELCAT retiré : aucune autorisation universitaire disponible.
// Le planning est désormais importé et lu exclusivement dans le navigateur.
app.use(['/api/auth','/api/edt'], (_req,res)=>res.status(410).json({error:'Importe ton export XML local : le relais universitaire est désactivé.'}));
app.use(express.json({limit:'8kb'}));
app.get('/api/health', (_req,res)=>res.json({ok:true}));
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
  const status=error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:502;
  // Diagnostic minimal : aucun message d’exception ni contenu de requête.
  if(status>=500) process.stderr.write(JSON.stringify({event:'request_failed',status,at:new Date().toISOString()})+'\n');
  res.status(status).json({error:status===400?'Requête invalide.':status===413?'Requête trop volumineuse.':'Service temporairement indisponible. Réessaie dans un instant.'});
});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{if(!production) process.stdout.write(`Emploi du temps : http://localhost:${process.env.PORT||3000}\n`);});
const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
export default server;
