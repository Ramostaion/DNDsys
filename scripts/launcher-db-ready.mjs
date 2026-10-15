import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(join(root,'apps/api/package.json'));
const {parse}=require('dotenv');
const {PrismaClient}=require('@prisma/client');
const env=parse(readFileSync(join(root,'apps/api/.env')));
const url=new URL(env.DATABASE_URL);url.searchParams.set('connect_timeout','2');
const db=new PrismaClient({datasourceUrl:url.toString()});
let ready=false;
try{
  const deadline=Date.now()+60_000;
  while(Date.now()<deadline){
    try{await db.$queryRaw`SELECT 1`;ready=true;break;}catch{/* The listener may precede SQL readiness. */}
    await setTimeout(500);
  }
}finally{await db.$disconnect();}
if(!ready){console.error('数据库尚未就绪，请确认连接配置与数据库状态。');process.exitCode=1;}
