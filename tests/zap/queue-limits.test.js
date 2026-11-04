const test=require('node:test');
const assert=require('node:assert/strict');
const {Queue}=require('../../src/whatsapp/queue');
test('duas conversas avançam sem executar dois pedidos do mesmo chat em paralelo',async()=>{
    const queue=new Queue(10,{concurrency:2});const started=[];let releaseA,releaseB;
    const a=queue.enqueue('a',async()=>{started.push('a1');await new Promise(r=>releaseA=r);});
    const a2=queue.enqueue('a',async()=>{started.push('a2');});
    const b=queue.enqueue('b',async()=>{started.push('b1');await new Promise(r=>releaseB=r);});
    assert.deepEqual(started,['a1','b1']);assert.equal(queue.activeCount,2);
    releaseA();await Promise.all([a,a2]);assert.deepEqual(started,['a1','b1','a2']);releaseB();await b;
});
test('pedido aguardando expira sem executar trabalho',async()=>{
    const queue=new Queue(10,{maxWaitMs:20});let release,ran=false;
    const first=queue.enqueue('a',()=>new Promise(r=>release=r));
    const pending=queue.enqueue('a',async()=>{ran=true;});
    await assert.rejects(pending,e=>e.code==='QUEUE_EXPIRED');assert.equal(ran,false);release();await first;
});
test('prazo de execução libera a fila mesmo se o trabalho não terminar',async()=>{
    const queue=new Queue(10,{taskTimeoutMs:20});
    const stalled=queue.enqueue('a',()=>new Promise(()=>{}));
    const next=queue.enqueue('b',async()=>42);
    await assert.rejects(stalled,e=>e.code==='QUEUE_TIMEOUT');assert.equal(await next,42);assert.equal(queue.activeCount,0);
});
test('cancelamento aborta apenas a conversa escolhida e permite nova requisição',async()=>{
    const queue=new Queue(10,{concurrency:2});let signal;
    const first=queue.enqueue('a',async s=>{signal=s;await new Promise(()=>{});});
    const rejected=assert.rejects(first,e=>e.code==='QUEUE_CANCELLED');
    const other=queue.enqueue('b',async()=>7);
    assert.equal(queue.cancel('a').aborted,true);await rejected;assert.equal(signal.aborted,true);assert.equal(await other,7);assert.equal(await queue.enqueue('a',async()=>8),8);
});
