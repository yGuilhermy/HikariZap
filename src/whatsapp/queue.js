function queueError(code,message,name='Error') { return Object.assign(new Error(message),{code,name}); }
class Queue {
    constructor(limit=20,options={}) {
        this.limit=limit;this.items=[];this.paused=false;this.running=new Map();this.nextId=0;
        this.concurrency=Math.max(1,Number(options.concurrency)||1);
        this.perChatLimit=Math.max(1,Number(options.perChatLimit)||3);
        this.maxWaitMs=Math.max(1,Number(options.maxWaitMs)||60000);
        this.taskTimeoutMs=Math.max(1,Number(options.taskTimeoutMs)||180000);
    }
    get active() { return this.running.values().next().value||null; }
    get activeCount() { return this.running.size; }
    enqueue(chatId,work) {
        if(this.paused)return Promise.reject(queueError('QUEUE_PAUSED','A Hikari está pausada.'));
        if(this.items.length>=this.limit||this.items.filter(item=>item.chatId===chatId).length>=this.perChatLimit)return Promise.reject(queueError('QUEUE_FULL','Já há pedidos aguardando atendimento nesta conversa.'));
        return new Promise((resolve,reject)=>{
            const item={chatId,work,resolve,reject,enqueuedAt:Date.now()};
            item.waitTimer=setTimeout(()=>{
                const index=this.items.indexOf(item);
                if(index<0)return;
                this.items.splice(index,1);
                reject(queueError('QUEUE_EXPIRED','Seu pedido aguardou tempo demais. Envie novamente quando a conversa estiver disponível.'));
                this.drain();
            },this.maxWaitMs);
            this.items.push(item);this.drain();
        });
    }
    cancel(chatId) {
        let aborted=false,dropped=0;
        for(const job of this.running.values())if(!chatId||job.chatId===chatId){job.controller.abort(queueError('QUEUE_CANCELLED','Operação cancelada.','AbortError'));aborted=true;}
        this.items=this.items.filter(item=>{
            if(chatId&&item.chatId!==chatId)return true;
            clearTimeout(item.waitTimer);item.reject(queueError('QUEUE_CANCELLED','Operação cancelada.','AbortError'));dropped++;return false;
        });
        return {aborted,dropped};
    }
    drain() {
        if(this.paused)return;
        while(this.running.size<this.concurrency) {
            const busyChats=new Set([...this.running.values()].map(job=>job.chatId));
            const index=this.items.findIndex(item=>!busyChats.has(item.chatId));
            if(index<0)return;
            const [item]=this.items.splice(index,1);clearTimeout(item.waitTimer);
            if(Date.now()-item.enqueuedAt>=this.maxWaitMs){item.reject(queueError('QUEUE_EXPIRED','Seu pedido aguardou tempo demais. Envie novamente.'));continue;}
            const id=++this.nextId,controller=new AbortController();
            this.running.set(id,{chatId:item.chatId,controller});
            this.run(id,item,controller);
        }
    }
    async run(id,item,controller) {
        let onAbort;
        const cancelled=new Promise((_,reject)=>{
            onAbort=()=>reject(controller.signal.reason||queueError('QUEUE_CANCELLED','Operação cancelada.','AbortError'));
            controller.signal.addEventListener('abort',onAbort,{once:true});
        });
        const timer=setTimeout(()=>controller.abort(queueError('QUEUE_TIMEOUT','O processamento excedeu o tempo disponível. Tente um pedido mais curto.','TimeoutError')),this.taskTimeoutMs);
        let work;
        try {controller.signal.throwIfAborted();work=Promise.resolve(item.work(controller.signal));}
        catch(error){work=Promise.reject(error);}
        try {const result=await Promise.race([work,cancelled]);controller.signal.throwIfAborted();item.resolve(result);}catch(error){item.reject(error);}
        finally {clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);this.running.delete(id);this.drain();}
    }
    pause() { this.paused=true;this.cancel(); }
    resume() { this.paused=false;this.drain(); }
}
module.exports={Queue};
