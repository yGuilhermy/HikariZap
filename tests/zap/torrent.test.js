const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {searchGames,getTorrentOrMagnet,validateTorrent}=require('../../src/services/torrentService');
const {createToolExecutor}=require('../../src/whatsapp/tools');
const {executeAgentLoop}=require('../../src/handlers/llmHandler');
const axios=require('axios');
const config=require('../../src/config');
const {createRouter}=require('../../src/whatsapp/router');
const info=Buffer.from('d6:lengthi1e4:name1:xe');
const torrent=Buffer.concat([Buffer.from('d4:info'),info,Buffer.from('e')]);
const hash=createHash('sha1').update(info).digest('hex');
const game={title:'Teste',provider:'Local',fileSize:'1 GB',hash,magnet:`magnet:?xt=urn:btih:${hash}&dn=Teste`};

test('catálogos importados retornam até cinco resultados, aliases e hashes válidos',async()=>{
    const games=await searchGames('gta v');
    assert.ok(games.length>0 && games.length<=5);
    assert.ok(games.every(x=>/^[a-f0-9]{40}$/i.test(x.hash)));
    assert.equal(new Set(games.map(x=>x.hash)).size,games.length);
    assert.deepEqual(await searchGames('zzzzjogoinexistentezzzz'),[]);
});
test('valida infohash, rejeita HTML e usa magnet original como fallback',async()=>{
    assert.equal(validateTorrent(torrent,hash),torrent);
    assert.throws(()=>validateTorrent(torrent,'0'.repeat(40)));
    assert.throws(()=>validateTorrent(Buffer.from('<html>error</html>'),hash));
    const file=await getTorrentOrMagnet(game,undefined,async()=>({data:torrent}));
    assert.equal(file.fallback,false);assert.match(file.fileName,/\.torrent$/);
    const fallback=await getTorrentOrMagnet(game,undefined,async()=>({data:Buffer.from('<html>not found</html>')}));
    assert.equal(fallback.fallback,true);assert.equal(fallback.buffer.toString(),game.magnet);
    const controller=new AbortController();controller.abort();
    await assert.rejects(getTorrentOrMagnet(game,controller.signal,async()=>({data:torrent})),{name:'AbortError'});
});
test('lista curta e download isolados por usuário/conversa, com expiração e substituição',async t=>{
    const execute=createToolExecutor({searchGames:async()=>[game],torrentFile:async()=>({buffer:torrent,fileName:'teste.torrent',mimetype:'application/x-bittorrent'})});
    const sent=[];
    const ctx={chatId:'group',senderId:'alice',send:async payload=>sent.push(payload)};
    await execute('search_game',{game_name:'Teste'},ctx);
    assert.equal(sent.length,1);assert.ok(!sent[0].text.includes('magnet:'));
    await assert.rejects(execute('download_game_torrent',{result_index:1},{...ctx,senderId:'bob'}),/não existe/);
    await assert.rejects(execute('download_game_torrent',{result_index:1},{...ctx,chatId:'other'}),/não existe/);
    await assert.rejects(execute('download_game_torrent',{result_index:2},ctx),/Escolha um número/);
    await execute('download_game_torrent',{result_index:1},ctx);
    assert.equal(sent.length,2);assert.equal(sent[1].document,torrent);assert.equal(ctx.mediaSent,true);
    const now=Date.now;t.after(()=>Date.now=now);Date.now=()=>now()+600001;
    await assert.rejects(execute('download_game_torrent',{result_index:1},ctx),/expirou/);
});
test('busca pela IA envia somente a lista sem uma segunda resposta',async t=>{
    const original=axios.post,local=config.localLlmEnabled;
    t.after(()=>{axios.post=original;config.localLlmEnabled=local;});config.localLlmEnabled=true;
    let calls=0;
    axios.post=async()=>{calls++;return {data:{choices:[{message:{content:null,tool_calls:[{id:'game1',type:'function',function:{name:'search_game',arguments:'{"game_name":"Teste"}'}}]}}]}};};
    const execute=createToolExecutor({searchGames:async()=>[game]});
    const sent=[];const ctx={chatId:'group',senderId:'alice',history:[],send:async payload=>sent.push(payload)};
    assert.equal(await executeAgentLoop('busque Teste',ctx,execute),'');
    assert.equal(calls,1);assert.equal(sent.length,1);
});

test('comandos do WhatsApp enviam uma lista e um documento, sem textos duplicados',async()=>{
    const sent=[];
    const execute=createToolExecutor({searchGames:async()=>[game],torrentFile:async()=>({buffer:Buffer.from(game.magnet),fileName:'magnet.txt',mimetype:'text/plain',fallback:true})});
    const store={seen:()=>false,history:()=>[],addHistory:()=>{}};
    const router=createRouter({store,executeTool:execute,agent:async()=>assert.fail('IA não deve ser acionada por comando')});
    for(const [i,text] of ['>buscar_jogo Teste','>torrent 1'].entries())await router.handle({id:String(i),text,chatId:'123@g.us',isGroup:true,senderId:'5511999999999@s.whatsapp.net',send:async payload=>sent.push(payload)});
    assert.equal(sent.length,2);assert.ok(sent[0].text);assert.equal(sent[1].fileName,'magnet.txt');
    assert.match(sent[1].caption,/magnet no arquivo de texto/);
});

test('resposta direta usa a lista citada e sem citação usa a busca mais recente',async()=>{
    const downloaded=[],sent=[],reactions=[];
    const execute=createToolExecutor({searchGames:async query=>[{...game,title:query}],torrentFile:async selected=>{
        downloaded.push(selected.title);return {buffer:torrent,fileName:'teste.torrent',mimetype:'application/x-bittorrent'};
    }});
    const router=createRouter({store:{seen:()=>false,history:()=>[],addHistory:()=>{}},executeTool:execute,agent:async()=>assert.fail('IA não deve escolher o torrent')});
    let sequence=0;
    const handle=(text,extra={})=>router.handle({id:String(++sequence),text,react:async emoji=>reactions.push(emoji),chatId:'123@g.us',isGroup:true,senderId:'5511999999999@s.whatsapp.net',send:async payload=>{sent.push(payload);return {key:{id:`reply-${sent.length}`}};},...extra});
    await handle('>torrent 1');
    assert.equal(reactions.at(-1),'\u274c');
    await handle('>torrent Primeiro jogo'); // reply-2
    await handle('>torrent Outro jogo'); // reply-3
    await handle('1',{quotedMessageId:'reply-1',isReplyToBot:true});
    await handle('>torrent 1');
    await handle('>torrent 1',{quotedMessageId:'reply-1',isReplyToBot:true});
    assert.deepEqual(downloaded,['Primeiro jogo','Outro jogo','Primeiro jogo']);
    await handle('>torrent 1',{quotedMessageId:'mensagem-desconhecida',isReplyToBot:true});
    await handle('>torrent 1',{quotedMessageId:'reply-1',isReplyToBot:true,senderId:'5511888888888@s.whatsapp.net'});
    assert.equal(downloaded.length,3);
    await handle('quero o 1',{quotedMessageId:'reply-1',isReplyToBot:true});
    await handle('manda o primeiro por favor',{quotedMessageId:'reply-1',isReplyToBot:true});
    assert.deepEqual(downloaded.slice(-2),['Primeiro jogo','Primeiro jogo']);
});
