// Mesure la page de connexion en build production ; aucun identifiant universitaire.
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
process.env.NODE_ENV='production';process.env.PORT='0';
process.env.SESSION_SECRET=randomBytes(32).toString('base64');
process.env.APP_ORIGIN='https://localhost';
const server=(await import('../server/index.js')).default;
if(!server.listening) await new Promise(resolve=>server.once('listening',resolve));
let chrome;
try {
  chrome=await launch({chromePath:process.env.CHROME_PATH,chromeFlags:['--headless']});
  const result=await lighthouse(`http://localhost:${server.address().port}/`,{port:chrome.port,output:'json',onlyCategories:['performance','accessibility','best-practices']});
  await writeFile(join(tmpdir(),'edt-lighthouse.json'),result.report);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result.lhr.categories).map(([key,value])=>[key,Math.round(value.score*100)]))));
  for(const audit of Object.values(result.lhr.audits)) if(audit.score!==null && audit.score<1 && audit.details?.type!=='opportunity') console.log(audit.id, audit.title, audit.displayValue||'');
}finally{await chrome?.kill();await new Promise(resolve=>server.close(resolve));}
