 'use strict';
const { createHash } = require('node:crypto');
const { ROLE_IDS } = require('./roleIds');
const LOL = '1521261614484033728';
const OFFICER = ROLE_IDS.REGIMENT_OFFICER_ROLE_ID;
async function notifyOfficers(service, id) {
 const {store,client}=service;
 const r=store.read().regiments.find(r=>r.id===id),notice=r?.poll?.officerNotice;
 // Absence means a pre-feature application: never retrofit a notification.
 if(!notice || !['pending','attempted','uncertain'].includes(notice.state))return;
 const poll=r.poll,ref=poll.messages[poll.policy.officerChannelId];
 if(poll.state!=='open'||!poll.openedAt||Date.now()>=Date.parse(poll.closesAt)||!ref?.channelId)return;
 const guild=client.guilds.cache.get(LOL);
 if(!guild||guild.available===false)return;
 const channel=await guild.channels.fetch(ref.channelId);
 if(!channel || channel.guildId!==LOL)throw new Error('Officer notification thread is outside LOL.');
 const marker=`Admission ${id}`;
 const save=(state,detail={})=>store.change(d=>{const n=d.regiments.find(x=>x.id===id)?.poll?.officerNotice;if(!n)return;Object.assign(n,{state,...detail});store.audit(d,'officer-notification-'+state,{guildId:LOL},{regimentId:id,roleId:OFFICER,...detail});});
 if(notice.state!=='pending') {
  // After an uncertain outcome inspect, never resend: Discord and disk cannot commit atomically.
  const recent=await channel.messages.fetch({limit:100});
  const found=recent.find(m=>m.author.id===client.user.id&&m.content===`<@&${OFFICER}> A new regiment admission vote is open. Please review this thread.\n${marker}`);
  if(found)save('sent',{messageId:found.id});else if(notice.state==='attempted')save('uncertain');
  return;
 }
 const role=await guild.roles.fetch(OFFICER);
 const permissions=channel.permissionsFor(await guild.members.fetchMe());
 if(!role || (!role.mentionable&&!permissions?.has('MentionEveryone')) || !permissions?.has(['ViewChannel','SendMessagesInThreads'])) {save('skipped',{reason:'Officer role missing or existing mention/thread permissions insufficient.'});return;}
 const reserved=store.change(d=>{const current=d.regiments.find(x=>x.id===id);const n=current?.poll?.officerNotice;if(n?.state!=='pending'||current.poll.state!=='open')return false;n.state='attempted';n.attemptedAt=new Date().toISOString();store.audit(d,'officer-notification-attempted',{guildId:LOL},{regimentId:id,roleId:OFFICER});return true;});
 if(!reserved)return;
 try {
  const message=await channel.send({content:`<@&${OFFICER}> A new regiment admission vote is open. Please review this thread.\n${marker}`,allowedMentions:{parse:[],roles:[OFFICER],users:[],repliedUser:false},nonce:createHash('sha256').update(`officer-notice:${id}`).digest('hex').slice(0,24),enforceNonce:true});
  save('sent',{messageId:message.id});
 } catch { save('uncertain'); }
}
module.exports={notifyOfficers,OFFICER};
