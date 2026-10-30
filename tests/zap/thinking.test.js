const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const config = require('../../src/config');
const {stripThinking,completion,executeAgentLoop,generateResponse} = require('../../src/handlers/llmHandler');

test('bloqueia o padrão Thinking da captura sem inventar uma resposta final',()=>{
    const leaked = `*Thinking:* The user is asking for the name of my creator. According to the instructions, I must refer to my creator as Guilhermy.
1. *Identify the core question:* The user wants to know who created me.
2. *Consult persona rules:* Private instructions here.
3. *Formulate the answer:*
* State the creator name: Guilhermy.`;
    assert.equal(stripThinking(leaked),'');
});
test('remove tags completas, abertas, finais órfãs e blocos de raciocínio',()=>{
    for(const tag of ['think','THINK','analysis','reasoning','thinking']) {
        assert.equal(stripThinking(`<${tag}>segredo</${tag}>Olá!`),'Olá!');
        assert.equal(stripThinking(`<${tag}>segredo`),'');
        assert.equal(stripThinking(`segredo</${tag}>Olá!`),'Olá!');
    }
    assert.equal(stripThinking('```analysis\nsegredo\n```\nOlá!'),'Olá!');
    assert.equal(stripThinking('```thinking\nsegredo'),'');
    assert.equal(stripThinking({reasoning:'segredo'}),'');
});
test('texto de análise só preserva uma resposta final explicitamente delimitada',()=>{
    assert.equal(stripThinking('**Analysis:** segredo\n**Final answer:** Olá!'),'Olá!');
    assert.equal(stripThinking('## Pensamento interno:\nsegredo\nResposta final: Olá!'),'Olá!');
    assert.equal(stripThinking('Resposta segura.\n*Thinking:* segredo'),'Resposta segura.');
    assert.equal(stripThinking('[start]assistant[channel]analysis[message]segredo[start]assistant[channel]final[message]Olá![end]'),'Olá!');
    assert.equal(stripThinking('<|im_start|>assistant<|channel|>analysis<|message|>segredo'),'');
});
test('preserva respostas normais e código sem marcadores de pensamento',()=>{
    for(const text of ['Meu criador é Guilhermy.','Estou pensando em uma solução.','Thinking, Fast and Slow é um livro.','A análise dos resultados está pronta.','```js\nconsole.log("oi");\n```'])assert.equal(stripThinking(text),text);
});
function mock(t,handler) {
    const original=axios.post,local=config.localLlmEnabled;
    config.localLlmEnabled=true;
    axios.post=handler;
    t.after(()=>{axios.post=original;config.localLlmEnabled=local;});
}
function response(content,extra={}) {return {data:{choices:[{message:{content,...extra}}]}};}

test('completion descarta análise isolada, ignora reasoning_content e limpa histórico antigo',async t=>{
    let calls=0;
    mock(t,async(url,payload)=>{
        assert.ok(!JSON.stringify(payload.messages).includes('SEGREDO_ANTIGO'));
        if(calls++===0)return response('*Thinking:* SEGREDO_NOVO');
        return response('<think>SEGREDO_NOVO</think>Meu criador é Guilhermy.',{reasoning_content:'SEGREDO_SEPARADO'});
    });
    const result=await completion([{role:'assistant',content:'*Thinking:* SEGREDO_ANTIGO'},{role:'user',content:'quem te criou?'}],undefined,false);
    assert.equal(result.content,'Meu criador é Guilhermy.');
    assert.equal(result.reasoning_content,undefined);
    assert.equal(calls,2);
});
test('texto de pensamento não vira chamada de ferramenta e legenda só recebe resposta limpa',async t=>{
    let calls=0;
    mock(t,async()=>{
        calls++;
        if(calls===1)return response('<think>default_api.search_web(query="segredo")</think>Aqui está.',{tool_calls:[{id:'img',type:'function',function:{name:'generate_image',arguments:'{"prompt":"gato"}'}}]});
        return response('*Thinking:* default_api.search_web(query="segredo")\nFinal answer: Pronto.');
    });
    const executed=[];
    const ctx={history:[],chatId:'test',store:{history:()=>[]}};
    const text=await executeAgentLoop('faça uma imagem',ctx,async(name)=>{
        assert.equal(ctx.mediaCaption,'Aqui está.');
        executed.push(name);return {ok:true};
    });
    assert.deepEqual(executed,['generate_image']);
    assert.equal(text,'Pronto.');
});
test('generateResponse também devolve apenas o texto final',async t=>{
    mock(t,async()=>response('**Thinking:** privado\n**Final answer:** Olá!'));
    assert.equal(await generateResponse('oi','test'),'Olá!');
});

test('chamadas compatíveis fora do pensamento continuam funcionando',async t=>{
    let calls=0;
    mock(t,async()=>response(calls++===0 ? '<think>privado</think>tool_code\nprint(default_api.search_web(query="Node.js"))' : 'Resultado da pesquisa.'));
    const executed=[];
    const ctx={history:[],chatId:'test',store:{history:()=>[]}};
    const result=await executeAgentLoop('pesquise Node.js',ctx,async(name,args)=>{executed.push([name,args]);return [];});
    assert.deepEqual(executed,[['search_web',{query:'Node.js'}]]);
    assert.equal(result,'Resultado da pesquisa.');
});

test('erro de provedor registra a causa devolvida pela API sem expor a chave',async t=>{
    const {logger}=require('../../src/utils/logger');
    const originalWarn=logger.warn,keys=config.geminiApiKeys,lmKey=config.lmStudioApiKey;
    const warnings=[];logger.warn=message=>warnings.push(message);
    config.geminiApiKeys=['secret-test-key'];config.lmStudioApiKey='secret-test-key';
    t.after(()=>{logger.warn=originalWarn;config.geminiApiKeys=keys;config.lmStudioApiKey=lmKey;});
    let calls=0;
    mock(t,async()=>{
        if(calls++===0)throw Object.assign(new Error('request failed'),{response:{status:400,data:[{error:{message:'Invalid request for secret-test-key'}}]}});
        return response('OK');
    });
    assert.equal((await completion([{role:'user',content:'oi'}],undefined,false)).content,'OK');
    assert.match(warnings[0],/400.*Invalid request/);
    assert.ok(!warnings[0].includes('secret-test-key'));
});
