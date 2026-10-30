const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const config = require('../../src/config');
const {convertCurrency} = require('../../src/handlers/currencyHandler');
const {format} = require('../../src/whatsapp/router');

function mock(t, get, provider='awesomeapi') {
    const original = axios.get, previous = config.currencyProvider, key = config.awesomeApiKey;
    axios.get=get; config.currencyProvider=provider; config.awesomeApiKey='';
    t.after(()=>{axios.get=original;config.currencyProvider=previous;config.awesomeApiKey=key;});
}
function response(from,to,bid,timestamp='1793200000') {
    return {data:{[from+to]:{code:from,codein:to,bid:String(bid),timestamp}}};
}
function unavailable(status) { return Object.assign(new Error('API indisponível'),{response:{status}}); }

test('cada pedido consulta somente o par solicitado e recebe uma cotação nova', async t=>{
    let calls=0;
    const controller=new AbortController();
    mock(t,async(url,options)=>{
        assert.ok(url.endsWith('/USD-BRL'));
        assert.equal(options.signal,controller.signal);
        return response('USD','BRL',5+(calls++));
    });
    const first=await convertCurrency(2,'dólar','reais',controller.signal);
    const second=await convertCurrency(2,'USD','BRL',controller.signal);
    assert.equal(first.result,10); assert.equal(second.result,12); assert.equal(calls,2);
    assert.equal(second.lastUpdate,new Date(1793200000*1000).toISOString());
    assert.equal(second.source,'AwesomeAPI');
    assert.match(format(second),/Fonte: AwesomeAPI/);
    assert.match(format(second),/cache de até 1 minuto/);
});
test('chave opcional usa cabeçalho e falha não retorna cotação anterior', async t=>{
    let calls=0;
    mock(t,async(url,options)=>{
        assert.equal(options.headers['x-api-key'],'test-key');
        assert.ok(!url.includes('test-key'));
        if(calls++)throw unavailable(429);
        return response('USD','BRL',5);
    });
    config.awesomeApiKey='test-key';
    assert.equal((await convertCurrency(1,'USD','BRL')).rate,5);
    const failed=await convertCurrency(1,'USD','BRL');
    assert.match(failed.error,/limite de requisições/); assert.equal(failed.rate,undefined);
    assert.equal(calls,2);
});
test('par inverso e taxa cruzada usam cotações recém-consultadas', async t=>{
    const calls=[];
    mock(t,async url=>{
        calls.push(url.split('/').at(-1));
        if(url.endsWith('/USD-BRL'))return response('USD','BRL',5);
        if(url.endsWith('/BTC-BRL'))return response('BTC','BRL',500000);
        throw unavailable(404);
    });
    assert.equal((await convertCurrency(10,'BRL','USD')).result,2);
    calls.length=0;
    const crypto=await convertCurrency(1,'BTC','USD');
    assert.equal(crypto.result,100000);
    assert.equal(crypto.calculation,'Taxa cruzada via BRL');
    assert.deepEqual(calls,['BTC-USD','USD-BTC','BTC-BRL','USD-BRL']);
});
test('Frankfurter é identificado como taxa diária, com data da fonte', async t=>{
    mock(t,async url=>{
        assert.ok(url.endsWith('/v2/rate/USD/BRL'));
        return {data:{base:'USD',quote:'BRL',rate:5.2,date:'2026-10-27'}};
    },'frankfurter');
    const quote=await convertCurrency(10,'USD','BRL');
    assert.equal(quote.result,52); assert.equal(quote.lastUpdate,'2026-10-27');
    assert.match(format(quote),/referência diária; não é cotação em tempo real/);
});
test('dados inválidos, falha de rede e cancelamento não fabricam cotações',async t=>{
    let answer=response('USD','BRL',0);
    mock(t,async()=>answer);
    assert.ok((await convertCurrency(1,'USD','BRL')).error);
    answer=response('USD','BRL','Infinity');
    assert.ok((await convertCurrency(1,'USD','BRL')).error);
    answer={data:{USDBRL:{code:'USD',codein:'BRL',bid:'5'}}};
    assert.ok((await convertCurrency(1,'USD','BRL')).error);
    axios.get=async()=>{throw unavailable(503);};
    assert.ok((await convertCurrency(1,'USD','BRL')).error);
    const controller=new AbortController();controller.abort();
    await assert.rejects(convertCurrency(1,'USD','BRL',controller.signal),{name:'AbortError'});
});
test('zero é preservado; entradas inválidas são rejeitadas antes da consulta',async t=>{
    mock(t,async()=>assert.fail('consulta inesperada'));
    assert.equal((await convertCurrency(0,'USD','USD')).result,0);
    assert.ok((await convertCurrency(Infinity,'USD','BRL')).error);
    assert.ok((await convertCurrency(-1,'USD','BRL')).error);
    assert.ok((await convertCurrency(1,'../USD','BRL')).error);
});
