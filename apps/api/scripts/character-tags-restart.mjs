import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient(),base=process.env.API_BASE||'http://localhost:3001';
const stateFile=join(tmpdir(),'projectdnd-character-tags-restart.json');
const hash=text=>createHash('sha256').update(text).digest('hex');
async function call(path,cookie,body){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${path}: ${JSON.stringify(data)}`);return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function login(name){return (await call('/auth/login',null,{username:name,password:process.env.SMOKE_PASSWORD||'demo12345'})).cookie;}
try{
  if(process.argv[2]==='prepare'){
    const existing=await readFile(stateFile,'utf8').catch(()=>null);assert.equal(existing,null,'verify/clean the existing restart test first');
    const gm=await login('demo-gm'),player=await login('demo-player-1');
    const oldRoomIds=(await db.room.findMany({select:{id:true}})).map(room=>room.id);
    const name=`QA tags restart ${randomUUID().slice(0,8)}`;
    const room=(await call('/rooms',gm,{name})).data;
    // Persist the exact cleanup identity immediately, even if later setup fails.
    await writeFile(stateFile,JSON.stringify({roomId:room.id,name,oldRoomIds}));
    await call('/rooms/join',player,{inviteCode:room.inviteCode});
    const owner=(await call('/auth/me',player)).data.id;
    const op=async(type,payload)=>(await call(`/rooms/${room.id}/operations`,gm,{id:randomUUID(),type,payload})).data;
    const a=await op('character.create',{name:'重启 A',ownerId:owner}),b=await op('character.create',{name:'重启 B'});
    const definition=await op('tagDefinition.create',{name:'重启保留标记',icon:'curse',color:'#b56ce2'});
    const notes=['角色 A 地下室秘密\n'.repeat(250),'角色 B 古书独立记录\n'.repeat(250)];
    const tags=[];
    for(const [index,character] of [a,b].entries())tags.push(await op('characterTag.attach',{characterId:character.id,tagDefinitionId:definition.id,definitionVersion:0,detailsMarkdown:notes[index],visibility:index===0?'OWNER':'GM_ONLY'}));
    await writeFile(stateFile,JSON.stringify({roomId:room.id,name,oldRoomIds,tagIds:tags.map(tag=>tag.id),hashes:notes.map(hash)}));
    console.log('Restart fixture saved in PostgreSQL. Restart the API, then run this script with verify.');
  }else if(process.argv[2]==='verify'){
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    const room=await db.room.findUnique({where:{id:state.roomId},select:{name:true}});assert.equal(room?.name,state.name);
    const gm=await login('demo-gm'),player=await login('demo-player-1');
    const gmView=(await call(`/rooms/${state.roomId}/snapshot`,gm)).data;
    assert.equal(gmView.characterTags.length,2);
    for(const [index,id] of state.tagIds.entries()){const tag=gmView.characterTags.find(tag=>tag.id===id);assert.equal(hash(tag.detailsMarkdown),state.hashes[index]);assert.ok(tag.detailsMarkdown.length>2000);}
    const playerView=(await call(`/rooms/${state.roomId}/snapshot`,player)).data;
    assert.equal(playerView.characterTags.length,1);assert.equal(playerView.characterTags[0].id,state.tagIds[0]);assert.equal(playerView.tagDefinitions.length,0);
    const current=new Set((await db.room.findMany({select:{id:true}})).map(room=>room.id));assert.ok(state.oldRoomIds.every(id=>current.has(id)));
    await db.room.delete({where:{id:state.roomId}});await unlink(stateFile);
    console.log('API restart persistence passed: two independent long notes, OWNER/GM visibility, existing rooms retained; fixture removed.');
  }else throw new Error('Use prepare, restart the API, then verify.');
}finally{await db.$disconnect();}
