const test=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios');
const config=require('../../src/config');
const {completion}=require('../../src/handlers/llmHandler');

test('quatro modelos Gemini tentam suas chaves em ordem antes de outros provedores',async t=>{
    const saved={};
    for(const key of ['geminiModel','geminiModelFallback','geminiModelFallback2','geminiModelFallback3','geminiApiKeys','localLlmEnabled'])saved[key]=config[key];
    const original=axios.post;
    t.after(()=>{Object.assign(config,saved);axios.post=original;});
    Object.assign(config,{geminiModel:'first',geminiModelFallback:'second',geminiModelFallback2:'third',geminiModelFallback3:'fourth',geminiApiKeys:['test-a','test-b'],localLlmEnabled:false});
    const calls=[];
    axios.post=async(url,payload,options)=>{
        const guide=payload.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
        assert.match(guide,/Guia público de uso da Hikari/);
        assert.match(guide,/não inicie buscas/);
        assert.ok(guide.includes(`${config.prefix || '>'}torrent <nome do jogo>`));
        assert.match(guide,/10 minutos/);
        calls.push([payload.model,options.headers.Authorization]);
        if(payload.model!=='fourth')throw Object.assign(new Error('indisponível'),{response:{status:404}});
        return {data:{choices:[{message:{content:'OK'}}]}};
    };
    assert.equal((await completion([{role:'user',content:'oi'}],undefined,false)).content,'OK');
    assert.deepEqual(calls,[['first','Bearer test-a'],['first','Bearer test-b'],['second','Bearer test-a'],['second','Bearer test-b'],['third','Bearer test-a'],['third','Bearer test-b'],['fourth','Bearer test-a']]);
    config.geminiModelFallback2='first';
    assert.deepEqual(config.getGeminiModels(),['first','second','fourth']);
});
