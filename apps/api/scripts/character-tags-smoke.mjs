import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
const db=new PrismaClient(),base=process.env.API_BASE||'http://localhost:3001';
const stage=(process.argv[2]||'E').toUpperCase();let roomId,roomName,checks=0;
async function call(path,cookie,body){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
function status(result,expected,label){assert.equal(result.status,expected,`${label}: ${JSON.stringify(result.data)}`);checks++;return result.data;}
function check(condition,label){assert.ok(condition,label);checks++;}
async function op(cookie,type,payload,id=randomUUID(),target=roomId){return call(`/rooms/${target}/operations`,cookie,{id,type,payload});}
async function snap(cookie){return status(await call(`/rooms/${roomId}/snapshot`,cookie),200,'snapshot');}
async function login(name){const r=await call('/auth/login',null,{username:name,password:process.env.SMOKE_PASSWORD||'demo12345'});status(r,200,'login');return r.cookie;}
try{
  const gm=await login(process.env.SMOKE_GM||'demo-gm'),a=await login('demo-player-1'),b=await login('demo-player-2');
  roomName=`QA tags ${randomUUID().slice(0,8)}`;
  const room=status(await call('/rooms',gm,{name:roomName}),201,'create room');roomId=room.id;
  for(const cookie of [a,b])status(await call('/rooms/join',cookie,{inviteCode:room.inviteCode}),200,'join');
  const aId=status(await call('/auth/me',a),200,'me').id,bId=status(await call('/auth/me',b),200,'me').id;
  const ca=status(await op(gm,'character.create',{name:'标签角色 A',ownerId:aId}),200,'character A');
  const cb=status(await op(gm,'character.create',{name:'标签角色 B',ownerId:bId}),200,'character B');
  const hidden=status(await op(gm,'character.create',{name:'隐藏角色',visibility:'GM'}),200,'hidden character');
  if(stage==='E'){
    let version=room.version;
    for(const field of [{fieldId:'strength',name:'力量',type:'number',defaultValue:12},{fieldId:'power',name:'战力',type:'number',formula:'{{strength}}*2'},{fieldId:'defense',name:'防御',type:'number',defaultValue:10},{fieldId:'hp',name:'生命',type:'number',defaultValue:20,isResource:true},{fieldId:'ap',name:'普通行动点',type:'number',defaultValue:2,isResource:true},{fieldId:'sp',name:'特殊行动点',type:'number',defaultValue:1,isResource:true}])version=status(await op(gm,'sheet.field.upsert',{version,field}),200,'existing sheet field').roomVersion;
    const armor=status(await op(gm,'item.create',{name:'标签回归护甲',kind:'装备',compatibleSlots:['护甲'],data:{modifiers:{defense:4}}}),200,'existing armor');
    const entry=status(await op(a,'inventory.add',{characterId:ca.id,itemId:armor.id}),200,'existing inventory');
    status(await op(a,'equipment.set',{characterId:ca.id,entryId:entry.id,slot:'胸部'}),200,'existing equipment');
    const buff=status(await op(gm,'template.create',{name:'标签回归祝福',kind:'STATUS',data:{modifiers:{strength:3}}}),200,'existing buff');
    status(await op(a,'template.apply',{characterId:ca.id,templateId:buff.id,shared:true}),200,'apply existing buff');
    const equipped=(await snap(gm)).characters.find(c=>c.id===ca.id);
    check(equipped.derived.values.power===30&&equipped.derived.values.defense===14&&equipped.derived.values.ap===2&&equipped.derived.values.sp===1,'formula/equipment/Buff fixture active');
  }
  const before=(await snap(gm)).characters.map(c=>({id:c.id,fieldValues:c.fieldValues,derived:c.derived,currentHp:c.currentHp,statuses:c.statuses,traits:c.traits,skills:c.skills,version:c.version}));
  const input={name:'受到诅咒',icon:'curse',color:'#b56ce2',templateDescription:'第一次分配初稿',defaultVisibility:'GM_ONLY',defaultPriority:10};
  let definition=status(await op(gm,'tagDefinition.create',input),200,'create definition');
  const longA='# 地下室的诅咒\n\n'+('第三次进入地下室时提醒 GM。独立剧情秘密，不自动扣血。\n'.repeat(110));
  const ta=status(await op(gm,'characterTag.attach',{characterId:ca.id,tagDefinitionId:definition.id,definitionVersion:definition.version,detailsMarkdown:longA}),200,'attach A');
  const tb=status(await op(gm,'characterTag.attach',{characterId:cb.id,tagDefinitionId:definition.id,definitionVersion:definition.version,detailsMarkdown:'接触古书后出现幻觉'}),200,'attach B');
  let updated=status(await op(gm,'characterTag.update',{id:ta.id,version:ta.version,detailsMarkdown:longA+'\n追加独立备注',visibility:'GM_ONLY',priority:20}),200,'edit A');
  let saved=await snap(gm);
  check(saved.characterTags.find(t=>t.id===ta.id).detailsMarkdown===longA+'\n追加独立备注','long note retained');
  check(saved.characterTags.find(t=>t.id===tb.id).detailsMarkdown==='接触古书后出现幻觉','B independent');
  definition=status(await op(gm,'tagDefinition.update',{id:definition.id,version:definition.version,...input,name:'诅咒线索',icon:'secret',color:'#62a9db',templateDescription:'新的初稿'}),200,'update appearance');
  saved=await snap(gm);
  check(saved.characterTags.every(t=>t.definition.name==='诅咒线索'&&t.definition.icon==='secret'&&t.definition.color==='#62a9db'),'appearance follows definition');
  check(saved.characterTags.find(t=>t.id===ta.id).detailsMarkdown===longA+'\n追加独立备注','template does not overwrite instance');
  status(await op(gm,'characterTag.attach',{characterId:ca.id,tagDefinitionId:definition.id,definitionVersion:definition.version}),409,'duplicate assignment');
  check((await db.characterTag.count({where:{characterId:ca.id,tagDefinitionId:definition.id}}))===1,'unique instance');
  const after=(await snap(gm)).characters.map(c=>({id:c.id,fieldValues:c.fieldValues,derived:c.derived,currentHp:c.currentHp,statuses:c.statuses,traits:c.traits,skills:c.skills,version:c.version}));
  check(JSON.stringify(before)===JSON.stringify(after),'no formula/resource/status/version side effects');
  const stored=await db.characterTag.findUniqueOrThrow({where:{id:ta.id}});check(stored.detailsMarkdown===updated.detailsMarkdown&&stored.detailsMarkdown.length>2000,'PostgreSQL persisted long detail');
  if(stage!=='A'){
    for(const cookie of [a,b]){const view=await snap(cookie);check(view.characterTags.length===0&&view.tagDefinitions.length===0,'GM_ONLY absent including library/count');check(!JSON.stringify(view).includes('第三次进入地下室'),'no private note anywhere');}
    updated=status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:longA,visibility:'OWNER',priority:20}),200,'OWNER');
    check((await snap(a)).characterTags.some(t=>t.id===ta.id),'owner sees OWNER');check(!(await snap(b)).characterTags.some(t=>t.id===ta.id),'other owner cannot see OWNER');
    await db.roomMember.update({where:{roomId_userId:{roomId,userId:bId}},data:{permissions:{editAllCharacters:true}}});
    check((await snap(b)).characterTags.some(t=>t.id===ta.id),'existing all-character controller sees OWNER');
    await db.roomMember.update({where:{roomId_userId:{roomId,userId:bId}},data:{permissions:{}}});
    let transferred=(await snap(gm)).characters.find(c=>c.id===ca.id);
    status(await op(gm,'character.update',{id:ca.id,version:transferred.version,patch:{ownerId:bId}}),200,'transfer owner');
    check(!(await snap(a)).characterTags.some(t=>t.id===ta.id),'former owner loses OWNER visibility');
    check((await snap(b)).characterTags.some(t=>t.id===ta.id),'new owner sees OWNER');
    transferred=(await snap(gm)).characters.find(c=>c.id===ca.id);
    status(await op(gm,'character.update',{id:ca.id,version:transferred.version,patch:{ownerId:aId}}),200,'restore owner');
    updated=status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:longA,visibility:'PUBLIC',priority:20}),200,'PUBLIC');
    check((await snap(b)).characterTags.some(t=>t.id===ta.id),'other player sees PUBLIC');
    status(await op(a,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'unauthorized',visibility:'PUBLIC',priority:0}),403,'player cannot edit');
    for(const type of ['tagDefinition.create','tagDefinition.update','tagDefinition.archive','characterTag.attach','characterTag.detach'])status(await op(a,type,{}),403,`player blocked ${type}`);
    const operationId=randomUUID();
    const first=status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'最新版备注',visibility:'PUBLIC',priority:1},operationId),200,'save with operation ID');
    const repeated=status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'最新版备注',visibility:'PUBLIC',priority:1},operationId),200,'duplicate save ID');
    check(first.version===repeated.version,'idempotent save');
    status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'旧窗口',visibility:'PUBLIC',priority:1}),409,'old window conflict');
    updated=first;
    const raced=await Promise.all([op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'窗口 1',visibility:'PUBLIC',priority:1}),op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'窗口 2',visibility:'PUBLIC',priority:1})]);
    check(raced.filter(r=>r.status===200).length===1&&raced.filter(r=>r.status===409).length===1,'concurrent windows cannot silently overwrite');updated=raced.find(r=>r.status===200).data;
    updated=status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'秘密恢复',visibility:'GM_ONLY',priority:1}),200,'revoke PUBLIC');
    check(!(await snap(b)).characterTags.some(t=>t.id===ta.id),'revoked note absent');
    const hiddenTag=status(await op(gm,'characterTag.attach',{characterId:hidden.id,tagDefinitionId:definition.id,definitionVersion:definition.version,visibility:'PUBLIC'}),200,'public tag on hidden character');
    check(!(await snap(a)).characterTags.some(t=>t.id===hiddenTag.id),'character visibility wins');
    status(await op(gm,'characterTag.update',{id:updated.id,version:updated.version,detailsMarkdown:'x',visibility:'INVALID',priority:0}),400,'visibility validated');
    status(await op(gm,'tagDefinition.create',{...input,icon:'<svg onload=alert(1)>'}),400,'invalid icon');
    const other=status(await call('/rooms',gm,{name:`QA tags foreign ${randomUUID().slice(0,8)}`}),201,'other room');
    try{status(await op(gm,'characterTag.attach',{characterId:ca.id,tagDefinitionId:definition.id,definitionVersion:definition.version},randomUUID(),other.id),404,'cross room references denied');}finally{await db.room.delete({where:{id:other.id}});}
  }
  if(['C','D','E'].includes(stage)){
    definition=status(await op(gm,'tagDefinition.archive',{id:definition.id,version:definition.version}),200,'archive');
    check((await snap(gm)).characterTags.find(t=>t.id===tb.id).detailsMarkdown==='接触古书后出现幻觉','archive keeps notes');
    status(await op(gm,'characterTag.attach',{characterId:ca.id,tagDefinitionId:definition.id,definitionVersion:definition.version}),409,'archived cannot attach');
    definition=status(await op(gm,'tagDefinition.restore',{id:definition.id,version:definition.version}),200,'restore');
    check((await snap(gm)).tagDefinitions.find(d=>d.id===definition.id).characterCount===3,'library association count');
  }
  if(['D','E'].includes(stage)){
    const batchDef=status(await op(gm,'tagDefinition.create',{...input,name:'批量线索',icon:'🔑'}),200,'emoji definition');
    const batch=status(await op(gm,'characterTag.attachBatch',{characterIds:[ca.id,cb.id],tagDefinitionId:batchDef.id,definitionVersion:batchDef.version}),200,'batch');
    check(batch.attached.length===2&&batch.attached[0].id!==batch.attached[1].id,'batch makes independent instances');
    status(await op(gm,'characterTag.update',{id:batch.attached[0].id,version:0,detailsMarkdown:'批量后 A 的独立备注',visibility:'GM_ONLY',priority:0}),200,'edit batch A');
    check((await db.characterTag.findUniqueOrThrow({where:{id:batch.attached[1].id}})).detailsMarkdown===input.templateDescription,'batch B unchanged');
    const duplicateBatch=status(await op(gm,'characterTag.attachBatch',{characterIds:[ca.id,cb.id],tagDefinitionId:batchDef.id,definitionVersion:batchDef.version}),200,'repeat batch');
    check(duplicateBatch.attached.length===0&&duplicateBatch.skipped.length===2,'batch skips existing without overwriting');
  }
  const char=(await snap(gm)).characters.find(c=>c.id===ca.id);
  status(await op(gm,'character.update',{id:ca.id,version:char.version,patch:{name:'改名后 A'}}),200,'rename');
  check((await snap(gm)).characterTags.some(t=>t.id===ta.id&&t.characterId===ca.id),'rename retains association');
  status(await op(gm,'characterTag.detach',{id:updated.id,version:updated.version}),200,'remove A');
  check((await snap(gm)).characterTags.some(t=>t.id===tb.id),'removing A preserves B');
  console.log(`character tags stage ${stage} passed: ${checks} checks`);
}finally{
  if(roomId){const room=await db.room.findUnique({where:{id:roomId},select:{name:true}});if(room?.name===roomName)await db.room.delete({where:{id:roomId}});}
  await db.$disconnect();
}
