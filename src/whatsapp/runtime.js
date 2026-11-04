const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function acquireSessionLock(directory) {
    const file = path.join(directory,'hikari-process.lock');
    const content = JSON.stringify({pid:process.pid,token:randomUUID()});
    for (let attempt=0;attempt<2;attempt++) {
        let descriptor;
        try {
            descriptor = fs.openSync(file,'wx',0o600);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const previous = fs.readFileSync(file,'utf8');
            let pid;
            try { pid = JSON.parse(previous).pid; } catch {}
            if (!Number.isInteger(pid) || pid <= 0) throw new Error('Trava de sessão inválida; confira se outra Hikari está aberta antes de remover hikari-process.lock.');
            let running = true;
            try { process.kill(pid,0); } catch (reason) {
                if (reason.code === 'ESRCH') running = false;
            }
            if (running) throw new Error('Outra instância já está usando esta sessão WhatsApp. Encerre-a antes de iniciar novamente.');
            if (fs.readFileSync(file,'utf8') === previous) fs.unlinkSync(file);
            continue;
        }
        try { fs.writeFileSync(descriptor,content); } finally { fs.closeSync(descriptor); }
        return () => {
            try { if (fs.readFileSync(file,'utf8') === content) fs.unlinkSync(file); } catch {}
        };
    }
    throw new Error('Não foi possível reservar a sessão WhatsApp para esta instância.');
}

function createSendLimiter({send,isActive,onRestricted,onLimit}) {
    let chain = Promise.resolve(), pending = 0, lastAttempt = 0;
    let recent = [];
    const byChat = new Map();
    const suppressed = message => Object.assign(new Error(message),{silent:true});
    return async (socket,jid,payload,options) => {
        if (pending >= 20) throw suppressed('Fila de envios cheia.');
        pending++;
        const task = chain.then(async () => {
            if (!isActive(socket)) throw suppressed('Conexão interrompida antes do envio.');
            const wait = Math.max(0,lastAttempt+2000-Date.now());
            if (wait) await new Promise(resolve => setTimeout(resolve,wait));
            if (!isActive(socket)) throw suppressed('Conexão interrompida antes do envio.');
            const now = Date.now();
            recent = recent.filter(at => now-at<60000);
            for (const [chat,times] of byChat) {
                const live = times.filter(at => now-at<60000);
                if (live.length) byChat.set(chat,live); else byChat.delete(chat);
            }
            const times = byChat.get(jid) || [];
            if (recent.length >= 20 || times.length >= 6) {
                onLimit();
                throw suppressed('Limite local de envios atingido; envio suprimido.');
            }
            // Failed or ambiguous attempts count too. Never resend automatically.
            lastAttempt = now;
            recent.push(now);
            byChat.set(jid,[...times,now]);
            try { return await send(socket,jid,payload,options); }
            catch (error) {
                const code = Number(error?.output?.statusCode || error?.statusCode || error?.response?.status);
                if ([401,403,429].includes(code)) onRestricted(code);
                error.silent = true;
                throw error;
            }
        });
        chain = task.catch(() => {});
        try { return await task; } finally { pending--; }
    };
}
module.exports = {acquireSessionLock,createSendLimiter};
