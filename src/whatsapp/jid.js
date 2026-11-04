const fs = require('node:fs');
const path = require('node:path');
const {logger} = require('../utils/logger');
function userJid(raw) {
    const match=String(raw||'').match(/^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid|c\.us)$/);
    return match?`${match[1]}@${match[2]==='c.us'?'s.whatsapp.net':match[2]}`:'';
}
const isPhoneJid=id=>/^\d{8,15}@s\.whatsapp\.net$/.test(id||'');
const isLidJid=id=>/^\d+@lid$/.test(id||'');
function chatJid(jid) { return /^\d+@(s\.whatsapp\.net|lid)$/.test(jid||'')||/^\d+(?:-\d+)?@g\.us$/.test(jid||''); }
class IdentityMap {
    constructor(file) {
        this.file=file;
        this.lidToPn=new Map();
        this.dirty=false;
        this.saveTimer=null;
        if(file&&fs.existsSync(file)) {
            try {
                const saved=JSON.parse(fs.readFileSync(file,'utf8'));
                if(saved.version!==1||!Array.isArray(saved.pairs))throw new Error();
                for(const [lid,pn] of saved.pairs.slice(-5000)) if(isLidJid(lid)&&isPhoneJid(pn))this.lidToPn.set(lid,pn);
            } catch { this.lidToPn.clear(); logger.warn('Cache PN/LID inválido; identidades desconhecidas permanecerão sem privilégios até serem informadas pelo WhatsApp.'); }
        }
    }
    // Call only with server-origin identity fields, never quoted text, mentions or profile names.
    learn(ids) {
        const values=[...new Set(ids.map(userJid).filter(Boolean))];
        const phones=values.filter(isPhoneJid),lids=values.filter(isLidJid);
        if(phones.length!==1||lids.length!==1)return;
        if(this.lidToPn.get(lids[0])===phones[0])return;
        this.lidToPn.set(lids[0],phones[0]);
        if(this.lidToPn.size>5000)this.lidToPn.delete(this.lidToPn.keys().next().value);
        this.dirty=true;
        if(this.file&&!this.saveTimer) {
            this.saveTimer=setTimeout(()=>this.flush(),500);
            this.saveTimer.unref();
        }
    }
    flush() {
        clearTimeout(this.saveTimer);
        this.saveTimer=null;
        if(!this.file||!this.dirty)return;
        try {
            fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
            const tmp=this.file+'.tmp';
            fs.writeFileSync(tmp,JSON.stringify({version:1,pairs:[...this.lidToPn]}),{mode:0o600});
            fs.renameSync(tmp,this.file);
            this.dirty=false;
        } catch { logger.warn('Não foi possível salvar o cache PN/LID; confira as permissões da pasta de dados.'); }
    }
    learnContact(contact) { this.learn([contact?.id,contact?.jid,contact?.lid,contact?.phoneNumber]); }
    learnMessageKey(key,isGroup) {
        this.learn(isGroup?[key.participant,key.participantPn,key.participantAlt,key.senderPn]:[key.remoteJid,key.remoteJidAlt,key.senderPn]);
    }
    resolve(id) { const normalized=userJid(id);return this.lidToPn.get(normalized)||normalized; }
    aliases(id) {
        const normalized=userJid(id),canonical=this.resolve(id);
        const aliases=new Set([normalized,canonical].filter(Boolean));
        for(const [lid,pn] of this.lidToPn)if(pn===canonical)aliases.add(lid);
        return [...aliases];
    }
    same(first,second) { const a=this.resolve(first),b=this.resolve(second);return Boolean(a&&b&&a===b); }
}
module.exports={userJid,chatJid,isPhoneJid,isLidJid,IdentityMap};
