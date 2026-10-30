const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
class Store {
    constructor(directory = config.dataDir) {
        fs.mkdirSync(directory, {recursive:true,mode:0o700});
        this.file = path.join(directory,'state.json');
        this.state = {version:2,accepted:{},banned:{},history:{},seen:{},helpNotified:{}};
        if (fs.existsSync(this.file)) {
            const saved = JSON.parse(fs.readFileSync(this.file,'utf8'));
            if (![1,2].includes(saved.version)) throw new Error('Versão de armazenamento incompatível.');
            for (const key of ['accepted','banned','history','seen']) {
                if (!saved[key] || typeof saved[key] !== 'object' || Array.isArray(saved[key])) throw new Error('Armazenamento inválido.');
                this.state[key] = saved[key];
            }
            for (const [chat, history] of Object.entries(this.state.history)) {
                if (!Array.isArray(history)) throw new Error('Histórico inválido.');
                this.state.history[chat] = history.slice(-config.maxHistory);
            }
            if (saved.helpNotified && typeof saved.helpNotified === 'object' && !Array.isArray(saved.helpNotified)) this.state.helpNotified = saved.helpNotified;
            this.save();
        }
    }
    save() {
        const temp = `${this.file}.tmp`;
        fs.writeFileSync(temp,JSON.stringify(this.state),{mode:0o600});
        fs.renameSync(temp,this.file);
    }
    seen(id) {
        if (Object.hasOwn(this.state.seen,id)) return true;
        const now = Date.now();
        this.state.seen[id] = now;
        this.state.seen = Object.fromEntries(Object.entries(this.state.seen).filter(([,t])=>now-t<86400000).slice(-5000));
        this.save();
        return false;
    }
    accepted(id) { return this.state.accepted[id] === 'zap-v2'; }
    accept(id) { this.state.accepted[id] = 'zap-v2'; this.save(); }
    helpNotified(id) { return Object.hasOwn(this.state.helpNotified,id); }
    markHelpNotified(id) { this.state.helpNotified[id] = Date.now(); this.save(); }
    banned(id) { return Object.hasOwn(this.state.banned,id); }
    ban(id,reason) { this.state.banned[id] = {reason:String(reason).slice(0,500),at:Date.now()}; this.save(); }
    unban(id) { delete this.state.banned[id]; this.save(); }
    history(chat) { return (this.state.history[chat] || []).slice(-config.maxHistory); }
    addHistory(chat,role,content) {
        if (!config.saveHistory) return;
        this.state.history[chat] = [...this.history(chat),{role,content:String(content).slice(0,8000)}].slice(-config.maxHistory);
        this.save();
    }
    clearHistory(chat) { delete this.state.history[chat]; this.save(); }
}
module.exports = { Store };
