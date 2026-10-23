 'use strict';
// Only future, genuinely approved admissions opt in; legacy registrations stay unchanged.
const {randomUUID}=require('node:crypto');
const {AuditLogEvent}=require('discord.js');
const LOL='1521261614484033728';
const PERSONEL='1521293714385801298';
const OPTIONAL='1521280822378889358';
const jobs=new WeakMap();
function eligible(r){return r?.status==='active'&&r.review?.decision==='approved'&&r.poll?.state==='approved'&&r.tagRoleProvision?.enabled===true;}
async function provisionTagRole(service,id){
 let active=jobs.get(service.store);if(!active){active=new Map();jobs.set(service.store,active);}if(active.has(id))return active.get(id);
 const job=provision(service,id).finally(()=>active.delete(id));active.set(id,job);return job;
}
async function provision(service,id){
 const {store,client}=service;let r=store.read().regiments.find(x=>x.id===id);if(!eligible(r))return {skipped:true};
 const guild=client.guilds.cache.get(LOL);if(!guild||guild.available===false)throw new Error('LOL is unavailable; tag role provisioning paused.');
 const actor={guildId:LOL};
 const save=(fn,action,detail={})=>store.change(d=>{const current=d.regiments.find(x=>x.id===id);if(!eligible(current))throw new Error('Regiment is no longer approved for tag role provisioning.');fn(current);store.audit(d,action,actor,{regimentId:id,...detail});});
 const roles=await guild.roles.fetch(),upper=roles.get(PERSONEL),lower=roles.get(OPTIONAL),me=await guild.members.fetchMe();
 if(!upper||!lower||upper.position<=lower.position)throw new Error('Confirmed PERSONEL/OPTIONAL role anchors are missing or reversed.');
 if(!me.permissions.has('ManageRoles')||me.roles.highest.position<=upper.position)throw new Error('Existing bot Manage Roles permission or hierarchy is insufficient for the tag block.');
 let role;
 if(r.tagRoleId){
  if(r.tagRoleProvision.roleId!==r.tagRoleId)throw new Error('Tag role ownership record does not match; refusing to manage it.');
  role=roles.get(r.tagRoleId);if(!role)throw new Error('Previously created tag role is missing; manual recovery required, no duplicate created.');
 }else if(r.tagRoleProvision.attemptedAt){
  if(!me.permissions.has('ViewAuditLog'))throw new Error('Creation outcome uncertain; existing View Audit Log access is required for safe recovery. No role recreated.');
  const audit=await guild.fetchAuditLogs({type:AuditLogEvent.RoleCreate,limit:100});
  const proof=[...audit.entries.values()].filter(e=>e.executor?.id===client.user.id&&e.reason===r.tagRoleProvision.reason&&roles.has(e.target?.id));
  if(proof.length!==1)throw new Error('Creation outcome uncertain: no unique matching bot audit entry. No role recreated.');
  role=roles.get(proof[0].target.id);
  save(current=>{current.tagRoleId=role.id;current.tagRoleProvision.roleId=role.id;current.tagRoleProvision.creationAuditId=proof[0].id;},'tag-role-creation-recovered',{roleId:role.id});
 }else{
  const reason=`Quartermaster regiment ${id} operation ${randomUUID()}`;
  const temporaryName=`QM pending ${randomUUID()}`;
  save(current=>Object.assign(current.tagRoleProvision,{attemptedAt:new Date().toISOString(),reason,temporaryName}),'tag-role-create-attempted');
  // Reserve before the API. A timeout or crash must be recovered from bot-authored audit evidence.
  role=await guild.roles.create({name:temporaryName,permissions:0n,hoist:false,mentionable:false,reason});
  save(current=>{current.tagRoleId=role.id;current.tagRoleProvision.roleId=role.id;},'tag-role-created',{roleId:role.id});
 }
 r=store.read().regiments.find(x=>x.id===id);if(!eligible(r))throw new Error('Regiment changed during tag provisioning.');
 if(role.managed||BigInt(role.permissions.bitfield)!==0n||role.hoist||role.mentionable)throw new Error('Owned tag role settings changed; refusing to modify or adopt a privileged role.');
 if(role.position>=me.roles.highest.position)throw new Error('Owned tag role is above the bot; provisioning paused.');
 if(role.name!==r.tag)await role.setName(r.tag,`Quartermaster approved regiment ${id}`);
 const fresh=await guild.roles.fetch(),currentUpper=fresh.get(PERSONEL),currentLower=fresh.get(OPTIONAL);role=fresh.get(role.id);
 if(!role||!currentUpper||!currentLower||currentUpper.position<=currentLower.position)throw new Error('Tag positioning prerequisites changed.');
 if(!(role.position<currentUpper.position&&role.position>currentLower.position))await role.setPosition(currentLower.position+1,{reason:`Quartermaster approved regiment ${id}`});
 const verified=await guild.roles.fetch();const positioned=verified.get(role.id);
 if(!positioned||!(positioned.position<verified.get(PERSONEL)?.position&&positioned.position>verified.get(OPTIONAL)?.position))throw new Error('Tag role position could not be verified; retry only the owned role.');
 if(r.tagRoleProvision.state!=='ready'||r.tagRoleProvision.lastError)save(current=>{current.tagRoleProvision.state='ready';current.tagRoleProvision.lastError=null;},'tag-role-ready',{roleId:role.id});
 return {roleId:role.id};
}
async function retryTagRoles(service){
 for(const r of service.store.read().regiments.filter(eligible)){
  try{await provisionTagRole(service,r.id);}
  catch(e){
   const detail=e.code ? `Discord operation failed (${Number(e.code)||'unknown'}). Provisioning paused; no duplicate role will be created.` : 'Tag provisioning incomplete. Check anchors, bot hierarchy and ownership audit; uncertain creation is never blindly repeated.';
   service.store.change(d=>{const current=d.regiments.find(x=>x.id===r.id);if(!eligible(current))return;current.tagRoleProvision.state='blocked';if(current.tagRoleProvision.lastError!==detail)service.store.audit(d,'tag-role-error',{guildId:LOL},{regimentId:r.id,error:detail});current.tagRoleProvision.lastError=detail;});
  }
 }
}
module.exports={provisionTagRole,retryTagRoles,PERSONEL,OPTIONAL};
