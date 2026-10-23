 'use strict';
const LOL='1521261614484033728';
function prefix(tag){return `[${String(tag).replace(/^\[|\]$/g,'')}] `;}
function choose(candidates,previous){if(!candidates.length)return null;const max=Math.max(...candidates.map(r=>r.size));const tied=candidates.filter(r=>r.size===max);return tied.find(r=>r.id===previous)||tied.sort((a,b)=>a.id.localeCompare(b.id))[0];}
function targetName(tag,base){const pre=prefix(tag);let suffix='';for(const char of String(base)){if(pre.length+suffix.length+char.length>32)break;suffix+=char;}return pre+suffix;}
async function syncNickname(service,member,data,context={}){
 if(member.guild.id!==LOL||member.user?.bot)return;
 const {store}=service;context.nicknameRosters ||= new Map();const candidates=[];
 for(const r of data.regiments.filter(r=>r.status==='active')){
  if(!context.nicknameRosters.has(r.guildId)){
   const guild=await service.guild(r.guildId);context.nicknameRosters.set(r.guildId,await guild.members.fetch());
  }
  const roster=context.nicknameRosters.get(r.guildId);
  const qualified=m=>!m.user?.bot&&(m.roles.cache.has(r.memberRoleId)||m.roles.cache.has(r.officerRoleId)||m.id===r.commanderId);
  if(roster.has(member.id)&&qualified(roster.get(member.id)))candidates.push({...r,size:[...roster.values()].filter(qualified).length});
 }
 let record=store.read().nicknames?.[member.id];const chosen=choose(candidates,record?.regimentId),current=member.nickname??null;
 const save=(next,action)=>store.change(d=>{d.nicknames ||= {};d.nicknames[member.id]=next;if(action)store.audit(d,action,{guildId:LOL},{subjectUserId:member.id,regimentId:next.regimentId||null});});
 if(record?.pending){
  if(current===record.pending.target){record={...record,lastApplied:current,pending:null};save(record,'nickname-write-recovered');}
  else if(current!==record.pending.before){save({...record,pending:null,paused:true},'nickname-user-edit-preserved');return;}
 }
 if(record?.paused)return;
 if(record?.lastApplied!==undefined&&current!==record.lastApplied&&!record.pending){save({...record,paused:true},'nickname-user-edit-preserved');return;}
 if(!chosen&&!record)return;
 if(!record){
  // A pre-existing matching prefix is not proof of bot ownership. Leave it untouched.
  if(current?.startsWith(prefix(chosen.tag).trimEnd()))return;
  record={base:current||member.user?.globalName||member.user?.username||member.displayName,originalNickname:current,lastApplied:current};
 }
 const target=chosen?targetName(chosen.tag,record.base):record.originalNickname;
 if(current===target){if(record.pending)save({...record,pending:null,lastApplied:target},'nickname-write-recovered');return;}
 const me=await member.guild.members.fetchMe();
 if(!me.permissions.has('ManageNicknames')||!member.manageable){
  if(record.skipReason!=='hierarchy-or-permission')save({...record,skipReason:'hierarchy-or-permission'},'nickname-skipped-hierarchy');return;
 }
 record={...record,regimentId:chosen?.id||null,skipReason:null,pending:{before:current,target}};save(record,'nickname-write-attempted');
 await member.setNickname(target,'Quartermaster approved regiment membership');
 if(chosen)save({...record,lastApplied:target,pending:null},'nickname-updated');
 else store.change(d=>{delete d.nicknames[member.id];store.audit(d,'nickname-restored',{guildId:LOL},{subjectUserId:member.id});});
}
async function reconcileNickname(service,member,data,context){
 try{await syncNickname(service,member,data,context);}
 catch(e){service.store.log('nickname-sync-error',{guildId:LOL},{subjectUserId:member.id,code:Number(e.code)||'UNCLASSIFIED'});}
}
module.exports={choose,prefix,targetName,syncNickname,reconcileNickname};
