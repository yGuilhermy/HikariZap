const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const axios=require('axios');
const config=require('../../src/config');
const {createRouter}=require('../../src/whatsapp/router');
const {Store}=require('../../src/whatsapp/store');
const {createToolExecutor}=require('../../src/whatsapp/tools');
test('pedido natural pesquisa e consulta Steam pelo loop real de ferramentas, sem comando',async t=>{
    const original=axios.post;const old=config.localLlmEnabled;config.localLlmEnabled=true;
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-agent-test-'));
    t.after(()=>{axios.post=original;config.localLlmEnabled=old;fs.rmSync(dir,{recursive:true,force:true});});
    const store=new Store(dir),sender='5511999999999@s.whatsapp.net';store.accept(sender);
    let count=0;const calls=[],sent=[];
    axios.post=async(url,payload)=>{
        count++;
        assert.ok(payload.tools.some(x=>x.function.name==='search_web'));
        assert.ok(payload.tools.every(x=>!x.function.name.startsWith('db_')));
        if(count===1){
            assert.match(payload.messages.at(-1).content,/pesquise/);
            return {data:{choices:[{message:{content:null,tool_calls:[{id:'web1',type:'function',extra_content:{google:{thought_signature:'test-signature'}},function:{name:'search_web',arguments:'{"query":"Node.js"}'}},{id:'steam1',type:'function',function:{name:'check_steam',arguments:'{"game":"Portal 2"}'}}]}}]}};
        }
        assert.equal(payload.messages.find(x=>x.tool_calls)?.tool_calls[0].extra_content.google.thought_signature,'test-signature');
        const results=payload.messages.filter(x=>x.role==='tool');assert.equal(results.length,2);assert.match(results[0].content,/nodejs.org/);assert.match(results[1].content,/Portal/);
        return {data:{choices:[{message:{content:'Node.js está em https://nodejs.org/. Portal 2 custa R$ 10 no teste.'}}]}};
    };
    const execute=createToolExecutor({search:async query=>{calls.push(['search_web',query]);return [{title:'Node.js',url:'https://nodejs.org/',snippet:'oficial'}];},steam:async game=>{calls.push(['check_steam',game]);return {name:'Portal 2',price:'R$ 10'};}});
    const router=createRouter({store,executeTool:execute});
    await router.handle({id:'1',chatId:sender,senderId:sender,text:'Hikari, pesquise Node.js e consulte Portal 2 na Steam.',send:async payload=>sent.push(payload)});
    assert.deepEqual(calls,[['search_web','Node.js'],['check_steam','Portal 2']]);assert.equal(count,2);assert.match(sent.at(-1).text,/nodejs.org/);
    assert.equal(store.history(sender).length,2);
});

test('ferramenta repetida reutiliza o resultado e mantém todas as respostas de tool_call no histórico',async t=>{
    const {executeAgentLoop}=require('../../src/handlers/llmHandler');
    const old=config.localLlmEnabled,original=axios.post;config.localLlmEnabled=true;
    t.after(()=>{config.localLlmEnabled=old;axios.post=original;});
    let rounds=0,executions=0;
    axios.post=async(url,body)=>{
        rounds++;
        if(rounds<=2)return {data:{choices:[{message:{content:null,tool_calls:[{id:'repeat-'+rounds,type:'function',function:{name:'search_web',arguments:'{"query":"node"}'}}]}}]}};
        const ids=body.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id);
        assert.deepEqual(ids,['repeat-1','repeat-2']);
        return {data:{choices:[{message:{content:'resultado final'}}]}};
    };
    const ctx={signal:new AbortController().signal,history:[],store:{history:()=>[]},chatId:'test'};
    assert.equal(await executeAgentLoop('pesquise node',ctx,async()=>{executions++;return {ok:true};}),'resultado final');
    assert.equal(executions,1);
});
