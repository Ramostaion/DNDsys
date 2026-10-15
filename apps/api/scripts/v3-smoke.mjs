import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';

const base=process.env.API_BASE||'http://localhost:3001';
const db=new PrismaClient();let temporaryRoom=null,temporaryUser=null,legacyFile=null,checks=0;
async function request(path,cookie,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
function expectStatus(result,status,label){assert.equal(result.status,status,`${label}: ${JSON.stringify(result.data)}`);checks++;return result.data;}
async function login(username,password){const result=await request('/api/auth/login',null,{username,password});expectStatus(result,200,`login ${username}`);return result.cookie;}
async function op(cookie,type,payload,roomId=temporaryRoom,id=randomUUID()){return request(`/api/rooms/${roomId}/operations`,cookie,{id,type,payload});}
async function snapshot(cookie){return expectStatus(await request(`/api/rooms/${temporaryRoom}/snapshot`,cookie),200,'snapshot');}
try{
  const username=`qa-${randomUUID().slice(0,12)}`,oldPassword='temporary-pass-1',newPassword='temporary-pass-2';
  const registered=await request('/api/auth/register',null,{username,password:oldPassword});temporaryUser=expectStatus(registered,200,'register temporary user').id;
  const changed=await request('/api/auth/password',registered.cookie,{oldPassword,newPassword});expectStatus(changed,200,'change password');
  expectStatus(await request('/api/auth/me',registered.cookie),401,'old session revoked');
  expectStatus(await request('/api/auth/me',changed.cookie),200,'new session valid');
  expectStatus(await request('/api/auth/login',null,{username,password:oldPassword}),401,'old password rejected');
  expectStatus(await request('/api/auth/login',null,{username,password:newPassword}),200,'new password accepted');
  const gm=await login(process.env.SMOKE_GM||'demo-gm',process.env.SMOKE_PASSWORD||'demo12345');
  const player=await login(process.env.SMOKE_PLAYER||'demo-player-1',process.env.SMOKE_PASSWORD||'demo12345');
  const partner=await login(process.env.SMOKE_PARTNER||'demo-player-2',process.env.SMOKE_PASSWORD||'demo12345');
  const room=expectStatus(await request('/api/rooms',gm,{name:`QA v3 ${randomUUID().slice(0,8)}`}),201,'create room');temporaryRoom=room.id;
  expectStatus(await request('/api/rooms/join',player,{inviteCode:room.inviteCode}),200,'join room');
  expectStatus(await request('/api/rooms/join',partner,{inviteCode:room.inviteCode}),200,'partner joins room');
  const playerId=(await request('/api/auth/me',player)).data.id;
  const partnerId=(await request('/api/auth/me',partner)).data.id;
  const hero=expectStatus(await op(gm,'character.create',{name:'测试角色',ownerId:playerId}),200,'create character');
  const recipient=expectStatus(await op(gm,'character.create',{name:'接收角色',ownerId:partnerId}),200,'create recipient');
  const npc=expectStatus(await op(gm,'character.create',{name:'测试 NPC'}),200,'create NPC');
  const hiddenNpc=expectStatus(await op(gm,'character.create',{name:'隐藏 NPC',visibility:'GM'}),200,'create hidden NPC');
  const publicMap=expectStatus(await op(gm,'map.create',{name:'公开地图'}),200,'create public map');
  const hiddenMap=expectStatus(await op(gm,'map.create',{name:'GM 私密地图',visibility:'GM'}),200,'create private map');
  legacyFile=`${randomUUID()}.png`;
  await writeFile(join(process.cwd(),'uploads',legacyFile),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==','base64'));
  await db.map.update({where:{id:hiddenMap.id},data:{imageUrl:`/uploads/${legacyFile}`}});
  assert.equal((await fetch(`${base}/uploads/${legacyFile}`,{headers:{cookie:gm}})).status,200);
  assert.equal((await fetch(`${base}/uploads/${legacyFile}`,{headers:{cookie:player}})).status,404);checks++;
  const hiddenToken=expectStatus(await op(gm,'token.create',{mapId:publicMap.id,characterId:hero.id,x:10,y:20,visibility:'GM'}),200,'create private token');
  expectStatus(await op(gm,'token.create',{mapId:publicMap.id,characterId:hiddenNpc.id,x:30,y:40}),200,'place private NPC');
  expectStatus(await op(gm,'map.activate',{id:hiddenMap.id}),200,'activate private map');
  let otherScene=await snapshot(player);
  assert.equal(otherScene.room.activeMapId,null);assert.equal(otherScene.maps.some(map=>map.id===hiddenMap.id),false);
  assert.equal(otherScene.characters.some(character=>character.id===hiddenNpc.id),false);
  assert.equal(otherScene.tokens.some(token=>token.id===hiddenToken.id||token.characterId===hiddenNpc.id),false);checks++;
  expectStatus(await op(player,'drawing.add',{mapId:hiddenMap.id,kind:'RULER',data:{shape:'LINE',distance:10,x:0,y:0}}),403,'private map drawing denied');
  expectStatus(await op(player,'token.move',{id:hiddenToken.id,version:hiddenToken.version,x:99,y:99}),403,'private token move denied');
  expectStatus(await op(gm,'map.activate',{id:publicMap.id}),200,'activate public map');
  let roomVersion=(await snapshot(gm)).room.version;
  const fields=[
    {fieldId:'defense',name:'防御',type:'number',defaultValue:10,group:'战斗数值'},
    {fieldId:'strength',name:'力量',type:'number',defaultValue:12,group:'基础属性'},
    {fieldId:'power',name:'战力',type:'number',formula:'{{strength}}*2',group:'基础属性'},
    {fieldId:'maxHp',name:'生命上限',type:'number',defaultValue:30,group:'资源'},
    {fieldId:'hp',name:'生命',type:'number',defaultValue:25,group:'资源',isResource:true,maxFieldId:'maxHp'},
    {fieldId:'ap',name:'普通行动点',type:'number',defaultValue:2,group:'资源',isResource:true},
    {fieldId:'sp',name:'特殊行动点',type:'number',defaultValue:1,group:'资源',isResource:true},
    {fieldId:'soul',name:'魂力',type:'number',defaultValue:4,group:'资源',isResource:true},
    {fieldId:'gmSecret',name:'主持人密值',type:'number',defaultValue:1,visibility:'GM'},
    {fieldId:'ownerSecret',name:'角色私值',type:'number',defaultValue:2,visibility:'OWNER'}
  ];
  for(const field of fields){const result=expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field}),200,`add ${field.fieldId}`);roomVersion=result.roomVersion;}
  const renamed=expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field:{...fields[1],name:'筋力',sort:99}}),200,'rename field');roomVersion=renamed.roomVersion;
  expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field:{fieldId:'broken',name:'错误公式',type:'number',formula:'{{missing}}'}}),400,'unknown formula field');
  const firstCycle=expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field:{fieldId:'cycleA',name:'循环 A',type:'number',defaultValue:1}}),200,'add cycle A');roomVersion=firstCycle.roomVersion;
  const secondCycle=expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field:{fieldId:'cycleB',name:'循环 B',type:'number',formula:'{{cycleA}}'}}),200,'add cycle B');roomVersion=secondCycle.roomVersion;
  expectStatus(await op(gm,'sheet.field.upsert',{version:roomVersion,field:{fieldId:'cycleA',name:'循环 A',type:'number',formula:'{{cycleB}}'}}),400,'reject formula cycle');
  expectStatus(await op(gm,'sheet.field.remove',{version:roomVersion,fieldId:'strength'}),409,'referenced field deletion denied');
  expectStatus(await op(player,'sheet.field.upsert',{version:roomVersion,field:{fieldId:'forbidden',name:'禁止',type:'number',defaultValue:0}}),403,'player cannot edit schema');
  let state=await snapshot(gm),character=state.characters.find(c=>c.id===hero.id);
  assert.equal(state.room.sheetMode,true);assert.equal(character.derived.values.power,24);checks++;
  const secretVersion=character.version;
  expectStatus(await op(gm,'character.field.set',{characterId:hero.id,fieldId:'gmSecret',version:secretVersion,value:42,reason:'GM 私密记录'}),200,'set private GM field');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);
  expectStatus(await op(player,'character.field.set',{characterId:hero.id,fieldId:'ownerSecret',version:character.version,value:19,reason:'角色私密记录'}),200,'set owner field');
  const ownerView=await snapshot(player),otherView=await snapshot(partner);
  assert.equal(ownerView.characters.find(c=>c.id===hero.id).fieldValues.gmSecret,undefined);
  assert.equal(ownerView.characters.find(c=>c.id===hero.id).fieldValues.ownerSecret,19);
  assert.equal(otherView.characters.find(c=>c.id===hero.id).fieldValues.ownerSecret,undefined);
  assert.equal(otherView.characters.find(c=>c.id===hero.id).derived.values.gmSecret,undefined);
  assert.equal(otherView.logs.some(log=>log.data?.fieldId==='gmSecret'||log.data?.fieldId==='ownerSecret'),false);
  assert.equal(ownerView.logs.some(log=>log.data?.fieldId==='gmSecret'),false);checks++;
  const armor=expectStatus(await op(gm,'item.create',{name:'铁甲',kind:'装备',data:{modifiers:{defense:4}},compatibleSlots:['护甲']}),200,'create armor');
  const entry=expectStatus(await op(player,'inventory.add',{characterId:hero.id,itemId:armor.id,quantity:1}),200,'add armor');
  expectStatus(await op(player,'equipment.set',{characterId:hero.id,slot:'胸部',entryId:entry.id}),200,'equip armor');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.defense,14);checks++;
  assert.equal(state.room.equipmentSlots.includes('胸部'),true);checks++;
  expectStatus(await request(`/api/rooms/${temporaryRoom}/equipment-slots`,gm,{version:state.room.version,slots:['主手','副手']}),409,'occupied equipment slot cannot be removed');
  const customArmor=expectStatus(await op(player,'inventory.instance.update',{id:entry.id,version:entry.version,data:{name:'专属铁甲',description:'角色私有实例',modifierRows:[{targetFieldId:'defense',operation:'ADD',value:7}]}}),200,'customize one item instance');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);
  assert.equal(character.derived.values.defense,17);assert.equal(character.inventory.find(item=>item.id===entry.id).data.name,'专属铁甲');checks++;
  expectStatus(await op(gm,'item.update',{id:armor.id,version:armor.version,patch:{data:{modifiers:{defense:6}}}}),200,'edit equipped item');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.defense,17);checks++;
  expectStatus(await op(gm,'item.update',{id:armor.id,version:armor.version+1,patch:{data:{modifiers:{defense:4}}}}),200,'restore item modifier');
  expectStatus(await op(player,'inventory.instance.update',{id:entry.id,version:customArmor.version,data:{}}),200,'return instance to shared definition');
  state=await snapshot(gm);assert.equal(state.characters.find(c=>c.id===hero.id).derived.values.defense,14);checks++;
  const wall=expectStatus(await op(gm,'template.create',{name:'铁壁',kind:'TRAIT',data:{modifiers:{defense:5}}}),200,'create wall');
  expectStatus(await op(player,'template.apply',{characterId:hero.id,templateId:wall.id,shared:true}),200,'apply wall');
  const weakness=expectStatus(await op(gm,'template.create',{name:'虚弱',kind:'STATUS',data:{modifiers:{defense:-2}}}),200,'create weakness');
  expectStatus(await op(player,'template.apply',{characterId:hero.id,templateId:weakness.id,shared:true}),200,'apply weakness');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.defense,17);assert.equal(character.derived.sources.defense.length,4);checks++;
  expectStatus(await op(player,'equipment.set',{characterId:hero.id,slot:'胸部',entryId:null}),200,'unequip armor');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.defense,13);checks++;
  expectStatus(await op(player,'inventory.transfer',{id:entry.id,targetCharacterId:recipient.id,quantity:1}),403,'direct cross-owner transfer denied');
  const currentEntry=(await snapshot(gm)).characters.find(c=>c.id===hero.id).inventory.find(item=>item.id===entry.id);
  const offer=expectStatus(await op(player,'trade.offer',{entryId:entry.id,version:currentEntry.version,targetCharacterId:recipient.id,quantity:1}),200,'offer trade');
  assert.equal((await snapshot(partner)).trades.some(t=>t.id===offer.id),true);checks++;
  expectStatus(await op(player,'trade.accept',{id:offer.id}),403,'sender cannot accept own trade');
  expectStatus(await op(partner,'trade.accept',{id:offer.id}),200,'recipient accepts trade');
  expectStatus(await op(partner,'trade.accept',{id:offer.id}),409,'trade cannot be accepted twice');
  state=await snapshot(gm);assert.equal(state.characters.find(c=>c.id===hero.id).inventory.some((item)=>item.id===entry.id),false);assert.equal(state.characters.find(c=>c.id===recipient.id).inventory.some((item)=>item.itemId===armor.id&&item.quantity===1),true);checks++;
  const strengthBuff=expectStatus(await op(gm,'template.create',{name:'力量祝福',kind:'STATUS',data:{modifiers:{strength:3}}}),200,'create buff');
  expectStatus(await op(player,'template.apply',{characterId:hero.id,templateId:strengthBuff.id,shared:true}),200,'apply buff');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.strength,15);assert.equal(character.derived.values.power,30);checks++;
  const buffInstance=character.statuses.find(s=>s.templateId===strengthBuff.id);
  expectStatus(await op(player,'template.enable',{characterId:hero.id,field:'statuses',instanceId:buffInstance.id,enabled:false,version:character.version}),200,'disable buff');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.strength,12);assert.equal(character.derived.values.power,24);checks++;
  const soulBuff=expectStatus(await op(gm,'template.create',{name:'魂力祝福',kind:'STATUS',data:{modifierRows:[{targetFieldId:'soul',operation:'ADD',value:3}]}}),200,'create row modifier');
  expectStatus(await op(player,'template.apply',{characterId:hero.id,templateId:soulBuff.id,shared:true}),200,'apply row modifier');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.soul,7);checks++;
  const encounter=expectStatus(await op(gm,'combat.start',{characterIds:[hero.id,npc.id,hiddenNpc.id],note:'测试遭遇'}),200,'start manual encounter');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.ap,2);assert.equal(state.encounter.combatants.every(c=>c.initiative===0),true);checks++;
  const publicEncounter=await snapshot(player);
  assert.equal(publicEncounter.encounter.combatants.some(combatant=>combatant.characterId===hiddenNpc.id),false);
  assert.equal(publicEncounter.combatEvents.some(event=>(event.data?.participants||[]).includes(hiddenNpc.id)),false);checks++;
  const declaration=expectStatus(await op(player,'combat.record',{kind:'DECLARATION',actorId:hero.id,targetId:npc.id,note:'尝试攻击'}),200,'declare attack');
  const correction=expectStatus(await op(player,'combat.correct',{eventId:declaration.id,note:'更正：攻击目标改为掩体'}),200,'correct own declaration');
  assert.equal(correction.data.correctsEventId,declaration.id);checks++;
  expectStatus(await op(partner,'combat.correct',{eventId:declaration.id,note:'越权更正'}),403,'other player cannot correct declaration');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.ap,2);assert.equal(character.derived.values.hp,25);checks++;
  expectStatus(await op(player,'combat.attack',{actorId:hero.id,targetId:npc.id,version:encounter.version}),410,'automatic attack disabled');
  const roll=expectStatus(await op(gm,'dice.roll',{expression:'2d6+1',reason:'测试自由骰'}),200,'roll 2d6+1');
  assert.equal(roll.details[0].rolls.length,2);assert.equal(roll.total,roll.details[0].rolls.reduce((a,b)=>a+b,1));checks++;
  const unusual=expectStatus(await op(gm,'dice.roll',{expression:'1d37'}),200,'roll d37');assert.ok(unusual.total>=1&&unusual.total<=37);checks++;
  const privateRoll=expectStatus(await op(gm,'dice.roll',{expression:'4d37+2',visibility:'PRIVATE'}),200,'private GM roll');
  assert.equal((await snapshot(player)).rolls.some(r=>r.id===privateRoll.id),false);assert.equal((await snapshot(gm)).rolls.some(r=>r.id===privateRoll.id),true);checks++;
  const playerPrivateRoll=expectStatus(await op(player,'dice.roll',{expression:'1d20',visibility:'PRIVATE',reason:'玩家私密检定'}),200,'player private roll');
  assert.equal((await snapshot(player)).rolls.some(r=>r.id===playerPrivateRoll.id),true);
  assert.equal((await snapshot(gm)).rolls.some(r=>r.id===playerPrivateRoll.id),true);
  assert.equal((await snapshot(partner)).rolls.some(r=>r.id===playerPrivateRoll.id),false);checks++;
  const id=randomUUID();const version=character.version;
  const adjustment=expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version,delta:-1,reason:'手动消耗'},temporaryRoom,id),200,'adjust AP');
  const duplicate=expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version,delta:-1,reason:'手动消耗'},temporaryRoom,id),200,'duplicate AP request');assert.deepEqual(duplicate,adjustment);checks++;
  expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version,delta:-1}),409,'stale AP version');
  expectStatus(await op(player,'character.field.adjust',{characterId:npc.id,fieldId:'ap',version:npc.version,delta:-1}),403,'other character permission');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.ap,1);assert.equal(state.logs.filter(log=>log.action==='character.field.adjust'&&log.data?.operationId===id).length,1);checks++;
  const currentEncounter=state.encounter;expectStatus(await op(gm,'combat.advance',{version:currentEncounter.version}),200,'advance turn');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);assert.equal(character.derived.values.ap,1);assert.equal(character.derived.values.sp,1);assert.ok(character.statuses.find(s=>s.id===buffInstance.id));checks++;
  const privateRuling=expectStatus(await op(gm,'combat.record',{kind:'RULING',note:'判定未命中',visibility:'PRIVATE'}),200,'private ruling');
  const privateCorrection=expectStatus(await op(gm,'combat.correct',{eventId:privateRuling.id,note:'更正：实际命中掩体'}),200,'private ruling correction');
  assert.equal(privateCorrection.visibility,'PRIVATE');
  assert.equal((await snapshot(player)).combatEvents.some(e=>e.id===privateRuling.id||e.id===privateCorrection.id),false);checks++;
  const quest=expectStatus(await op(gm,'quest.create',{name:'公开任务',description:'寻找遗迹',privateNote:'GM：入口在北侧',isPublic:true}),200,'create quest with private note');
  let playerQuest=(await snapshot(player)).quests.find(item=>item.id===quest.id);
  assert.equal(playerQuest.description,'寻找遗迹');assert.equal(Object.hasOwn(playerQuest,'privateNote'),false);checks++;
  expectStatus(await op(gm,'quest.update',{id:quest.id,version:quest.version,patch:{privateNote:'GM：改为南侧入口'}}),200,'edit private quest note');
  playerQuest=(await snapshot(player)).quests.find(item=>item.id===quest.id);
  assert.equal(Object.hasOwn(playerQuest,'privateNote'),false);checks++;
  assert.equal((await snapshot(gm)).quests.find(item=>item.id===quest.id).privateNote,'GM：改为南侧入口');checks++;
  let permissionVersion=(await snapshot(gm)).room.version;
  const controlled=expectStatus(await request(`/api/rooms/${temporaryRoom}/permission-mode`,gm,{version:permissionVersion,mode:'CONTROLLED',settings:{}}),200,'set controlled permission mode');permissionVersion=controlled.version;
  expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version:character.version,delta:1}),403,'controlled field edit denied');
  expectStatus(await op(player,'template.apply',{characterId:hero.id,templateId:wall.id}),403,'controlled template install denied');
  expectStatus(await op(player,'trade.offer',{entryId:entry.id,version:0,targetCharacterId:recipient.id,quantity:1}),403,'controlled trade denied');
  expectStatus(await op(player,'item.create',{name:'受控物品'}),403,'controlled public item edit denied');
  const free=expectStatus(await request(`/api/rooms/${temporaryRoom}/permission-mode`,gm,{version:permissionVersion,mode:'FREE',settings:{}}),200,'set free permission mode');permissionVersion=free.version;
  expectStatus(await op(player,'item.create',{name:'自由模式物品'}),200,'free public item edit');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);
  expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version:character.version,delta:1,reason:'自由模式调整'}),200,'free field edit');
  const mixed=expectStatus(await request(`/api/rooms/${temporaryRoom}/permission-mode`,gm,{version:permissionVersion,mode:'MIXED',settings:{}}),200,'restore mixed permission mode');permissionVersion=mixed.version;
  expectStatus(await op(player,'item.create',{name:'混合模式禁止'}),403,'mixed public item edit denied');
  expectStatus(await request(`/api/rooms/${temporaryRoom}/members/${playerId}/permissions`,gm,{publicItems:true,characterValues:false}),200,'member permission override');
  expectStatus(await op(player,'item.create',{name:'成员例外物品'}),200,'member item override allowed');
  state=await snapshot(gm);character=state.characters.find(c=>c.id===hero.id);
  expectStatus(await op(player,'character.field.adjust',{characterId:hero.id,fieldId:'ap',version:character.version,delta:1}),403,'member field override denied');
  state=await snapshot(gm);
  const slotsUpdated=expectStatus(await request(`/api/rooms/${temporaryRoom}/equipment-slots`,gm,{version:state.room.version,slots:['武器','防具']}),200,'set custom equipment slots');
  assert.deepEqual(slotsUpdated.equipmentSlots,['武器','防具']);checks++;
  expectStatus(await op(player,'equipment.set',{characterId:hero.id,slot:'胸部',entryId:null}),400,'old slot rejected after room customization');
  console.log(`v3 API smoke passed: ${checks} assertions, room ${temporaryRoom} will be removed`);
}finally{
  if(temporaryRoom){try{const room=await db.room.findUnique({where:{id:temporaryRoom},select:{name:true}});if(room?.name.startsWith('QA v3 '))await db.room.delete({where:{id:temporaryRoom}});}catch{console.error(`QA room cleanup pending: ${temporaryRoom}`);}}
  if(legacyFile)await unlink(join(process.cwd(),'uploads',legacyFile)).catch(()=>{});
  if(temporaryUser)await db.user.delete({where:{id:temporaryUser}}).catch(()=>console.error(`QA account cleanup pending: ${temporaryUser}`));
  await db.$disconnect();
}
