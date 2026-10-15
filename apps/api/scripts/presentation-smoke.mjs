import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {unlink} from 'node:fs/promises';
import sharp from 'sharp';
import {PrismaClient} from '@prisma/client';

const db=new PrismaClient(),api=process.env.API_BASE||'http://localhost:3001',password=process.env.SMOKE_PASSWORD||'demo12345';
let roomId,checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
async function call(path,cookie,method='GET',body){const response=await fetch(`${api}${path}`,{method,headers:{...(cookie?{cookie}:{}) ,...(body instanceof FormData?{}:body?{'content-type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const data=response.headers.get('content-type')?.includes('json')?await response.json():null;return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function login(username){const response=await call('/api/auth/login',null,'POST',{username,password});check(response.status===200,`login ${username}`);return response.cookie;}
try{
  const gm=await login('demo-gm'),p1=await login('demo-player-1'),p2=await login('demo-player-2');
  const room=await call('/api/rooms',gm,'POST',{name:`QA presentation ${randomUUID().slice(0,8)}`});check(room.status===201,'create room');roomId=room.data.id;
  for(const cookie of [p1,p2])check((await call('/api/rooms/join',cookie,'POST',{inviteCode:room.data.inviteCode})).status===200,'join room');
  const bytes=await sharp({create:{width:600,height:400,channels:3,background:'#a66845'}}).png().toBuffer();
  const ids=[];
  for(const title of ['线索 A','线索 B','线索 C']){const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),`${title}.png`);form.append('title',title);const result=await call(`/api/rooms/${roomId}/presentation/assets`,gm,'POST',form);check(result.status===201,`upload ${title}: ${JSON.stringify(result.data)}`);ids.push(result.data.id);}
  const base=`/api/rooms/${roomId}/presentation`;
  const group=await call(`${base}/groups`,gm,'POST',{name:'第一章'});check(group.status===201,'create chapter');
  check((await call(`${base}/groups/${group.data.id}`,gm,'PATCH',{name:'开场'})).data.name==='开场','rename chapter');
  const edited=await call(`${base}/assets/${ids[0]}`,gm,'PATCH',{title:'密信',caption:'玩家可见密信',gmNotes:'GM：这里有陷阱',tags:['线索'],groupId:group.data.id,sortOrder:-1});check(edited.status===200&&edited.data.title==='密信','edit asset metadata');
  const cueA=await call(`${base}/cues`,gm,'POST',{assetId:ids[0],groupId:group.data.id,transition:'fade',captionOverride:'演出专用字幕'});check(cueA.status===201,'create cue');
  const cueB=await call(`${base}/cues`,gm,'POST',{assetId:ids[0],groupId:group.data.id,transition:'slow_zoom'});check(cueB.status===201,'reuse asset in another cue');
  check((await call(`${base}/cues/${cueB.data.id}`,gm,'DELETE')).status===200,'delete one cue');
  check((await call(`${base}/assets/${ids[0]}/image/screen`,gm)).status===200,'deleting cue kept image');
  const invalid=new FormData();invalid.append('file',new Blob(['<script>invalid</script>'],{type:'image/png'}),'false.png');
  check((await call(`${base}/assets`,gm,'POST',invalid)).status===400,'invalid image rejected');
  check((await call(`${base}/assets`,gm)).data.length===3,'failed upload left no asset');
  check((await call(`${base}/assets`,p1)).data.length===0,'private assets absent from player list');
  check((await call(`${base}/assets/${ids[0]}/image/thumb`,p1)).status===403,'private image not visible');
  check((await call(`${base}/assets/${ids[0]}/image/thumb`,gm)).status===200,'GM private preview');
  let current=(await call(`${base}/current`,p1)).data;check(current.status==='idle'&&current.revision===0,'initial idle');
  const send=async(type,assetId,version,id=randomUUID(),allowHistory=false)=>call(`${base}/commands`,gm,'POST',{id,type,assetId,version,allowHistory});
  let result=await call(`${base}/commands`,gm,'POST',{id:randomUUID(),version:0,type:'play',cueId:cueA.data.id});check(result.status===200&&result.data.revision===1,'first cue play');
  check((await call(`${base}/current`,p1)).data.asset.id===ids[0],'player sees A');
  check((await call(`${base}/current`,p1)).data.asset.caption==='演出专用字幕','cue caption override visible');
  check((await call(`${base}/current`,p1)).data.asset.gmNotes===undefined,'GM note hidden');
  check((await call(`${base}/assets/${ids[0]}/image/screen`,p2)).status===200,'second player loads A');
  check((await call(`${base}/assets`,p1)).data.length===0,'no replay without consent');
  const sameId=randomUUID();result=await send('play',ids[1],1,sameId);check(result.status===200&&result.data.revision===2,'switch B');
  check((await send('play',ids[1],1,sameId)).data.revision===2,'duplicate command idempotent');
  check((await send('play',ids[2],1)).status===409,'stale revision rejected');
  result=await send('play',ids[2],2,randomUUID(),true);check(result.status===200&&result.data.revision===3,'switch C');
  check((await call(`${base}/current`,p2)).data.asset.id===ids[2],'late snapshot sees C');
  check((await call(`${base}/assets`,p1)).data.length===1,'replay only C');
  result=await send('blackout',undefined,3);check(result.status===200&&result.data.revision===4,'blackout');
  check((await call(`${base}/current`,p1)).data.status==='blackout','blackout is persistent');
  result=await send('unblackout',undefined,4);check(result.status===200&&result.data.revision===5,'unblackout');
  result=await send('end',undefined,5);check(result.status===200&&result.data.revision===6,'end');
  check((await call(`${base}/current`,p1)).data.status==='idle','end persistent');
  check((await call(`${base}/assets/${ids[0]}/image/screen`,p1)).status===403,'nonreplay image hidden after end');
  check((await call(`${base}/assets/${ids[2]}/image/screen`,p1)).status===200,'replay image retained');
  check((await call(`${base}/assets`,p2)).data.length===1,'replay list for second player');
  check((await call(`${base}/assets`,p1,'POST',{})).status!==200,'player cannot upload');
  check((await call(`${base}/assets/${ids[0]}`,gm,'DELETE',{})).status===409,'referenced asset needs confirmation');
  const deleted=await call(`${base}/assets/${ids[0]}`,gm,'DELETE',{confirm:true});check(deleted.status===200&&deleted.data.removedCues===1,'confirmed delete removes cue');
  check((await call(`${base}/assets/${ids[0]}/image/screen`,gm)).status===404,'deleted asset unavailable');
  check((await call(`${base}/groups/${group.data.id}`,gm,'DELETE')).status===200,'delete empty chapter');
  const missing=await db.presentationAsset.findUniqueOrThrow({where:{id:ids[2]},select:{screenName:true}});
  await unlink(join(resolve(process.cwd(),process.env.UPLOAD_DIR||'uploads',roomId,'presentation'),missing.screenName));
  check((await call(`${base}/assets/${ids[2]}/image/screen`,p1)).status===404,'missing file reports unavailable');
  check((await send('play',ids[2],6)).status===409,'missing file cannot be shown again');
  check((await call(`${base}/current`,p1)).data.status==='idle','failed play preserves prior state');
  console.log(`presentation smoke passed: ${checks} checks`);
}finally{
  if(roomId){const room=await db.room.findUnique({where:{id:roomId},select:{name:true}}).catch(()=>null);if(room?.name.startsWith('QA presentation ')){
    const assets=await db.presentationAsset.findMany({where:{roomId},select:{storageName:true,screenName:true,thumbName:true}});
    await db.room.delete({where:{id:roomId}});
    const root=resolve(process.cwd(),process.env.UPLOAD_DIR||'uploads',roomId,'presentation');
    for(const asset of assets)for(const name of [asset.storageName,asset.screenName,asset.thumbName])await unlink(join(root,name)).catch(()=>{});
  }}await db.$disconnect();
}
