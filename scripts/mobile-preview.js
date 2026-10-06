// Serveur de recette uniquement : planning fictif, jamais lancé par npm start/Docker.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {isoDate,weekDays} from '../src/calendar.js';
const days=weekDays(isoDate(new Date()));
const events=days.flatMap((day,i)=>i===6?[]:[['08:30','10:30','Mathématiques et didactique des apprentissages'],['14:00','16:00','Sciences de l’éducation et pratique professionnelle']].map(([start,end,subject],j)=>`<event id="${i}-${j}" date="${day}"><starttime>${start}</starttime><endtime>${end}</endtime><module>${subject}</module><category>${j?'TD':'CM'}</category><room>CT-Gymnase (Institut National Supérieur du Professorat et de l’Éducation de Chaumont)</room><staff>Enseignant de démonstration</staff><group>Promotion de test</group><notes>Données fictives réservées à la recette mobile.</notes></event>`)).join('');
const upstream=createServer((_req,res)=>{res.setHeader('Content-Type','application/xml');res.end(`<timetable>${events}</timetable>`);});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
process.env.NODE_ENV='production';process.env.PORT='0';
process.env.APP_ORIGIN='https://localhost';process.env.TRUSTED_PROXIES??='loopback';process.env.SESSION_SECRET=randomBytes(32).toString('base64');
process.env.CELCAT_XML_URL=`http://127.0.0.1:${upstream.address().port}`;
const {createSessionToken}=await import('../server/lib/session.js');
const token=await createSessionToken(JSON.stringify({cookies:[]}));
const server=(await import('../server/index.js')).default;
const handler=server.listeners('request')[0];server.removeAllListeners('request');
server.on('request',(req,res)=>{if(req.url!=='/api/auth/login')req.headers.cookie=`edt_session=${token}`;handler(req,res);});
if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
console.log(`Recette mobile — données fictives : http://localhost:${server.address().port}`);
process.on('SIGINT',()=>{server.close();upstream.close();});
