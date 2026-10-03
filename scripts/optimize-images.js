import sharp from 'sharp';
import {mkdir,stat} from 'node:fs/promises';
const source=new URL('../assets/source/forest.png',import.meta.url);
const destination=new URL('../src/assets/',import.meta.url);
await mkdir(destination,{recursive:true});
for(const [name,width,height] of [['forest-banner',1440,420],['forest-mobile',720,240],['forest-login',640,860]]){
  const path=new URL(`${name}.webp`,destination);
  await sharp(source.pathname).resize(width,height,{fit:'cover',position:'centre'}).webp({quality:78,effort:6}).toFile(path.pathname);
  console.log(name,Math.round((await stat(path)).size/1024)+' Ko');
}
