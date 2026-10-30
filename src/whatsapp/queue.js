class Queue {
    constructor(limit = 20) { this.limit = limit; this.items = []; this.active = null; this.paused = false; }
    enqueue(chatId, work) {
        if (this.paused) return Promise.reject(new Error('A Hikari está pausada.'));
        if (this.items.length >= this.limit || this.items.filter(x => x.chatId === chatId).length >= 3) return Promise.reject(new Error('Fila cheia; tente novamente em instantes.'));
        return new Promise((resolve, reject) => { this.items.push({chatId, work, resolve, reject}); this.drain(); });
    }
    cancel(chatId) {
        let aborted = false;
        if (this.active && (!chatId || this.active.chatId === chatId)) {
            this.active.controller.abort();
            aborted = true;
        }
        const remaining = [];
        let dropped = 0;
        for (const item of this.items) {
            if (!chatId || item.chatId === chatId) {
                item.reject(new Error('Operação cancelada.'));
                dropped++;
            } else remaining.push(item);
        }
        this.items = remaining;
        return {aborted, dropped};
    }
    async drain() {
        if (this.active || this.paused || !this.items.length) return;
        const item = this.items.shift();
        const controller = new AbortController();
        this.active = {chatId: item.chatId, controller};
        try { item.resolve(await item.work(controller.signal)); } catch (err) { item.reject(err); }
        finally { this.active = null; this.drain(); }
    }
    pause() {
        this.paused = true;
        this.active?.controller.abort();
        for (const item of this.items.splice(0)) item.reject(new Error('Operação cancelada pelo dono.'));
    }
    resume() { this.paused = false; this.drain(); }
}
module.exports = { Queue };
