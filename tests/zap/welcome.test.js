const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../../src/whatsapp/store');
const {createRouter}=require('../../src/whatsapp/router');

test('nota na primeira resposta privada persiste após reiniciar e limpar contexto, sem aparecer em grupos',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-welcome-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const sent=[],sender='5511999999999@s.whatsapp.net';
    let store=new Store(dir),router=createRouter({store,agent:async()=> 'Olá!'});
    const message=(id,extra={})=>({id,text:'oi',senderId:sender,chatId:sender,send:async p=>sent.push(p),...extra});
    await router.handle(message('1',{chatId:'123@g.us',isGroup:true,isBotMentioned:true}));
    assert.equal(sent[0].text,'Olá!');assert.equal(store.helpNotified(sender),false);
    await router.handle(message('2'));
    assert.equal(sent[1].text,'Olá!\n\nUse >ajuda para ver tudo que eu posso fazer.');
    assert.equal(store.history(sender).at(-1).content,'Olá!');
    store.clearHistory(sender);store=new Store(dir);router=createRouter({store,agent:async()=> 'Olá!'});
    await router.handle(message('3'));
    assert.equal(sent[2].text,'Olá!');
});

test('falha de envio não marca a nota como recebida',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-welcome-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const store=new Store(dir),sender='5511999999999@s.whatsapp.net';
    const router=createRouter({store,agent:async()=> 'Olá!'});
    await assert.rejects(router.handle({id:'1',text:'oi',senderId:sender,chatId:sender,send:async()=>{throw new Error('Envio falhou');}}));
    assert.equal(store.helpNotified(sender),false);
});
