import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {DEFAULT_RULES} from '@dnd/shared';
import {characterDerived} from '../src/domain.js';
const db=new PrismaClient();
async function main(){
  const passwordHash=await bcrypt.hash('demo12345',12);
  const users=[];
  for(const username of ['demo-gm','demo-player-1','demo-player-2','demo-player-3'])users.push(await db.user.upsert({where:{username},update:{},create:{username,passwordHash}}));
  let room=await db.room.findUnique({where:{inviteCode:'DEMO2026'}});
  if(!room)room=await db.room.create({data:{name:'灰烬之城 · 示例房间',description:'用于体验多人地图、人物卡与装备计算',ownerId:users[0].id,inviteCode:'DEMO2026',rules:DEFAULT_RULES as any}});
  for(const [index,user] of users.entries())await db.roomMember.upsert({where:{roomId_userId:{roomId:room.id,userId:user.id}},update:{},create:{roomId:room.id,userId:user.id,role:index===0?'GM':'PLAYER'}});
  let map=await db.map.findFirst({where:{roomId:room.id,name:'城外荒原'}});
  if(!map)map=await db.map.create({data:{roomId:room.id,name:'城外荒原',width:1600,height:900}});
  await db.room.update({where:{id:room.id},data:{activeMapId:map.id}});
  const item=await db.itemDefinition.findFirst({where:{roomId:room.id,name:'旅行护甲'}})||await db.itemDefinition.create({data:{roomId:room.id,name:'旅行护甲',kind:'装备',description:'防御 +3 的轻甲',data:{防御:3},compatibleSlots:['胸部']}});
  for(let i=1;i<=3;i++){
    const name=['','艾琳','洛恩','米拉'][i];let c=await db.character.findFirst({where:{roomId:room.id,name}});
    if(!c)c=await db.character.create({data:{roomId:room.id,name,ownerId:users[i].id,attributes:{力量:10,敏捷:12,体质:14,智力:10,感知:10,魅力:10},currentHp:28}});
    const entry=await db.inventoryEntry.findFirst({where:{characterId:c.id,itemId:item.id}})||await db.inventoryEntry.create({data:{characterId:c.id,itemId:item.id,position:0,quantity:1}});
    if(i===1)await db.equippedItem.upsert({where:{characterId_slot:{characterId:c.id,slot:'胸部'}},update:{entryId:entry.id},create:{characterId:c.id,entryId:entry.id,slot:'胸部'}});
    if(!await db.mapToken.findFirst({where:{mapId:map.id,characterId:c.id}}))await db.mapToken.create({data:{mapId:map.id,characterId:c.id,x:250+i*180,y:360}});
    const current=await db.character.findUniqueOrThrow({where:{id:c.id},include:{equipment:{include:{entry:{include:{item:true}}}}}});
    await db.character.update({where:{id:c.id},data:{derived:characterDerived(current,DEFAULT_RULES) as any}});
  }
  console.log('示例房间邀请码：DEMO2026；账号 demo-gm、demo-player-1/2/3；密码 demo12345');
}
main().finally(()=>db.$disconnect());
