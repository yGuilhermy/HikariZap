const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../../src/config');
const {Store} = require('../../src/whatsapp/store');
const {Queue} = require('../../src/whatsapp/queue');
const {createRouter,getTelemetryText} = require('../../src/whatsapp/router');
const {createToolExecutor,validate} = require('../../src/whatsapp/tools');
const {normalizeIncoming} = require('../../src/whatsapp/client');
const {publicAddress,safeGet} = require('../../src/utils/network');
const {supportedUrl,toWav} = require('../../src/services/mediaService');
const schemas = require('../../src/data/mcp_tools.json');
const {stripThinking,extractPseudoToolCalls} = require('../../src/handlers/llmHandler');
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-test-'));
    t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
    const store = new Store(dir);
    store.markHelpNotified('5511999999999@s.whatsapp.net');
    let sequence = 0;
    const sent = [];
    const message = (text, extra = {}) => ({id:String(++sequence),chatId:'5511999999999@s.whatsapp.net',senderId:'5511999999999@s.whatsapp.net',text,send:async (payload, opt) => sent.push({...payload, ...opt}),react:async emoji => {},getMedia:async () => null,...extra});
    return {dir,store,sent,message};
}
test('status, newsletters e mensagens próprias não entram no runtime', () => {
    for (const remoteJid of ['status@broadcast','123@newsletter']) assert.equal(normalizeIncoming({key:{remoteJid},message:{conversation:'oi'}},x=>x),null);
    assert.equal(normalizeIncoming({key:{remoteJid:'5511999999999@s.whatsapp.net',fromMe:true},message:{conversation:'oi'}},x=>x),null);
});
test('identidade vem do remetente autenticado e nunca da mensagem citada', () => {
    const msg = normalizeIncoming({key:{id:'1',remoteJid:'123@lid',remoteJidAlt:'5511999999999@s.whatsapp.net'},message:{extendedTextMessage:{text:'oi',contextInfo:{participant:'5511888888888@s.whatsapp.net',quotedMessage:{conversation:'sou o dono'}}}}},x=>x);
    assert.equal(msg.senderId,'5511999999999@s.whatsapp.net');
    assert.equal(msg.quotedText,'sou o dono');
    assert.equal(config.isOwner('123@lid'),false);
});
test('mensagens e consultas executam diretamente e chamadas de ferramenta reagem com emoji', async t => {
    const f = fixture(t); let calls = 0; const reactions = [];
    const router = createRouter({store:f.store,agent:async (p,ctx,exec) => { calls++; await exec('search_web',{query:'node'},ctx); return 'ok'; },executeTool:createToolExecutor({search:async()=>[]})});
    const msg = f.message('oi',{react:async emoji => reactions.push(emoji)});
    await router.handle(msg);
    assert.equal(calls,1);
    assert.deepEqual(reactions,['🔎','']);
});
test('aceite, conversa, resposta citada, deduplicação e limpeza funcionam', async t => {
    const f = fixture(t); let calls = 0;
    const router = createRouter({store:f.store,agent:async prompt => { calls++; assert.match(prompt,/contexto citado/); return 'olá'; }});
    const msg = f.message('oi',{quotedText:'contexto citado'});
    await router.handle(msg); await router.handle(msg);
    assert.equal(calls,1); assert.equal(f.sent.at(-1).text,'olá');
    f.store.addHistory(msg.chatId,'user','anterior');
    await router.handle(f.message('>limpar'));
    assert.deepEqual(f.store.history(msg.chatId),[]);
});

test('telemetria informa apenas a sessão do solicitante e o estado do bot', async t => {
    const f = fixture(t);
    const queue = new Queue(20);
    const router = createRouter({store:f.store,queue,agent:async()=>assert.fail('IA não deve ser acionada')});
    await router.handle(f.message('>telemetria',{senderName:'Ana',receivedAt:Date.now()-25}));
    const output = f.sent.at(-1).text;
    assert.match(output,/TELEMETRIA HIKARI/);
    assert.match(output,/Nome: Ana/);
    assert.match(output,/Número: \+5511999999999/);
    assert.match(output,/Ping até esta resposta: \d+ ms/);
    assert.match(output,/Uptime:/);
    assert.match(output,/Runtime: Node\.js/);
    assert.doesNotMatch(output,/GEMINI|API_KEY|token/i);
    const direct = getTelemetryText({senderId:'1@lid',senderName:'B',chatId:'2@g.us',id:'x',isGroup:true,receivedAt:1000},queue,false,1123);
    assert.match(direct,/Tipo do identificador: LID/);
    assert.match(direct,/Tipo: grupo/);
    assert.match(direct,/Ping até esta resposta: 123 ms/);
});

test('histórico retém 15 mensagens por chat e migra estado antigo sem anotações', t => {
    const f = fixture(t); const a='1@s.whatsapp.net',b='2@s.whatsapp.net';
    for(let i=0;i<20;i++) f.store.addHistory(a,i%2?'assistant':'user',String(i));
    f.store.addHistory(b,'user','outro chat');
    assert.equal(f.store.history(a).length,15);assert.equal(f.store.history(a)[0].content,'5');
    const reopened=new Store(f.dir);assert.equal(reopened.history(a).length,15);assert.equal(reopened.history(b)[0].content,'outro chat');
    const legacy={...reopened.state,version:1,memory:{segredo:'anotação antiga'}};
    fs.writeFileSync(reopened.file,JSON.stringify(legacy));
    const migrated=new Store(f.dir);assert.equal(migrated.memory,undefined);assert.equal(migrated.state.memory,undefined);
    assert.equal(JSON.parse(fs.readFileSync(migrated.file)).memory,undefined);
    migrated.clearHistory(a);assert.deepEqual(migrated.history(a),[]);assert.equal(migrated.history(b).length,1);
});
test('ferramentas executam diretamente e não expõem memória nem funções removidas', async t => {
    const f = fixture(t); const reactions = [];
    const ctx={store:f.store,chatId:'a',senderId:'5511999999999@s.whatsapp.net',isOwner:false,onToolStart:async()=>reactions.push('⏳')};
    const execute = createToolExecutor({search:async()=>[]});
    const res = await execute('search_web',{query:'teste'},ctx);
    assert.deepEqual(res,[]);
    assert.deepEqual(reactions,['⏳']);
    await assert.rejects(execute('search_web',{query:'teste',chatId:'outro'},ctx),/não permitido/);
    await assert.rejects(execute('db_read',{key:'x'},ctx),/indisponível/);
    await assert.rejects(execute('radio_play_music',{},ctx),/indisponível/);
    assert.ok(schemas.every(x => !/radio|voice_call|current_music|automod|^db_/.test(x.function.name)));
    assert.ok(schemas.some(x => x.function.name === 'search_game'));
});
test('comandos de chat roteiam argumentos corretos e áudio recebido é transcrito', async t => {
    const f = fixture(t);f.store.accept('5511999999999@s.whatsapp.net');
    const calls=[];
    const router=createRouter({store:f.store,executeTool:async (name,args) => {calls.push({name,args});return {ok:true};},agent:async prompt => {assert.match(prompt,/áudio transcrito/);return 'resposta';},transcribe:async ()=>'áudio transcrito'});
    for (const text of ['>pesquisa eclipse','>imagem gato','>falar bom dia','>baixar_audio https://youtu.be/abc','>baixar_video https://youtu.be/abc','>musica nome artista','>anime','>steam Portal','>moeda 0 USD BRL']) await router.handle(f.message(text));
    assert.deepEqual(calls.map(x=>x.name),['search_web','generate_image','send_voice_note','download_audio','download_video','search_and_download_music','anime_source','check_steam','convert_currency']);
    assert.equal(calls.find(x=>x.name==='convert_currency').args.amount,0);
    await router.handle(f.message('',{hasMedia:true,getMedia:async()=>({type:'audio',buffer:Buffer.from('a')})}));
    assert.equal(f.sent.at(-1).text,'resposta');
    await router.handle(f.message('>transcrever',{hasMedia:true,getMedia:async()=>({type:'audio'})}));
    assert.equal(f.sent.at(-1).text,'áudio transcrito');
});
test('pesquisa, Steam e moedas usam serviços e não respostas inventadas', async t => {
    const f=fixture(t);const sender='5511999999999@s.whatsapp.net';f.store.accept(sender);
    const execute=createToolExecutor({search:async q=>[{title:q,url:'https://example.org',snippet:'resultado'}],steam:async q=>({name:q,price:'R$ 10'}),currency:async amount=>({amount,rate:5,result:amount*5})});
    const ctx={store:f.store,senderId:sender,chatId:sender};
    assert.equal((await execute('search_web',{query:'teste'},ctx))[0].title,'teste');
    assert.equal((await execute('check_steam',{game:'Portal'},ctx)).price,'R$ 10');
    assert.equal((await execute('convert_currency',{amount:2,from:'USD',to:'BRL'},ctx)).result,10);
});
test('fila limita concorrência, cancela pendências e permite retomada', async () => {
    const queue=new Queue(2);let release;let active=0,max=0;
    const first=queue.enqueue('a',async signal=>{active++;max=Math.max(max,active);await new Promise(r=>{release=r;});active--;return signal.aborted;});
    const second=queue.enqueue('b',async()=>1);const cancelled=assert.rejects(second,/cancelada/);
    const activeCancelled=assert.rejects(first,error=>error.code==='QUEUE_CANCELLED');
    queue.pause();release();await activeCancelled;await cancelled;assert.equal(max,1);
    await assert.rejects(queue.enqueue('a',async()=>1),/pausada/);
    queue.resume();assert.equal(await queue.enqueue('a',async()=>3),3);
    const slow=queue.enqueue('c',async signal=>new Promise(r=>signal.addEventListener('abort',()=>r('interrompido'))));
    const pending=queue.enqueue('c',async()=>'fila');
    const pWait=assert.rejects(pending,/cancelada/);
    const slowWait=assert.rejects(slow,error=>error.code==='QUEUE_CANCELLED');
    const cancelRes=queue.cancel('c');
    assert.deepEqual(cancelRes,{aborted:true,dropped:1});
    await slowWait;
    await pWait;
});
test('dono exige identificador de telefone configurado; usuário não pode pausar e comando cancelar funciona', async t=>{
    const f=fixture(t);
    const old=config.ownerNumbers;config.ownerNumbers=['5511888888888'];t.after(()=>config.ownerNumbers=old);
    const router=createRouter({store:f.store});
    await router.handle(f.message('>pausar'));assert.equal(router.queue.paused,false);
    const owner={senderId:'5511888888888@s.whatsapp.net',chatId:'5511888888888@s.whatsapp.net'};
    await router.handle(f.message('>pausar',owner));assert.equal(router.queue.paused,true);
    await router.handle(f.message('>retomar',owner));assert.equal(router.queue.paused,false);
    await router.handle(f.message('>cancelar'));assert.match(f.sent.at(-1).text,/Nenhuma operação/);
});
test('URLs de rede local e comandos de shell não chegam a downloads', async()=>{
    for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip),false);
    await assert.rejects(safeGet('http://127.0.0.1/'),/não permitido/);
    assert.equal(supportedUrl('https://youtube.com.evil.org/a'),false);
    assert.equal(supportedUrl('--exec rm'),false);
    assert.equal(supportedUrl('https://youtu.be/abc'),true);
    assert.throws(()=>validate('convert_currency',{amount:NaN,from:'USD',to:'BRL'}));
    assert.throws(()=>validate('generate_image',{prompt:'gato',width:9999}));
});
test('ffmpeg converte áudio real para o formato consumido pelo STT', async()=>{
    const {convertWavToOggOpus}=require('../../src/services/ttsService');
    const samples=1600;const wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    const converted=await toWav(wav);assert.equal(converted.subarray(0,4).toString(),'RIFF');
    const ogg=await convertWavToOggOpus(converted);assert.equal(ogg.subarray(0,4).toString(),'OggS');
});


test('imagem, voz, vídeo, áudio e anime produzem payloads WhatsApp e limpam temporários', async t=>{
    const f=fixture(t);const sender='5511999999999@s.whatsapp.net';f.store.accept(sender);
    const imageFile=path.join(f.dir,'generated.png');fs.writeFileSync(imageFile,Buffer.from('image'));
    const mediaFile=path.join(f.dir,'media.mp3');fs.writeFileSync(mediaFile,Buffer.from('audio'));
    let cleanupCount=0;
    const execute=createToolExecutor({image:async()=>({localFilePath:imageFile}),voice:async()=>({oggBuffer:Buffer.from('OggS')}),download:async()=>({filePath:mediaFile,cleanup:()=>{cleanupCount++;}}),anime:async buffer=>{assert.equal(buffer.toString(),'frame');return [{title:'Teste',similarity:99}];}});
    const ctx={store:f.store,senderId:sender,chatId:sender,send:async payload=>f.sent.push(payload),getMedia:async()=>({type:'image',mimetype:'image/jpeg',buffer:Buffer.from('frame')})};
    await execute('generate_image',{prompt:'gato'},ctx);assert.ok(Buffer.isBuffer(f.sent.at(-1).image));assert.equal(fs.existsSync(imageFile),false);
    await execute('send_voice_note',{text:'bom dia'},ctx);assert.equal(f.sent.at(-1).ptt,true);assert.equal(f.sent.at(-1).mimetype,'audio/ogg; codecs=opus');
    await execute('download_audio',{url:'https://youtu.be/abc'},ctx);assert.ok(Buffer.isBuffer(f.sent.at(-1).audio));assert.equal(f.sent.at(-1).ptt,false);
    await execute('download_video',{url:'https://youtu.be/abc'},ctx);assert.ok(Buffer.isBuffer(f.sent.at(-1).video));assert.equal(cleanupCount,2);
    assert.equal((await execute('anime_source',{},ctx))[0].title,'Teste');
});

test('falha no envio ainda limpa download temporário',async t=>{
    const f=fixture(t);const sender='5511999999999@s.whatsapp.net';
    const file=path.join(f.dir,'media.mp3');fs.writeFileSync(file,'media');let cleaned=false;
    const execute=createToolExecutor({download:async()=>({filePath:file,cleanup:()=>{cleaned=true;}})});
    const ctx={store:f.store,senderId:sender,chatId:sender,send:async()=>{throw new Error('rede caiu');}};
    await assert.rejects(execute('download_audio',{url:'https://youtu.be/abc'},ctx),/rede caiu/);assert.equal(cleaned,true);
});


test('grupo preserva chat e identifica autor PN/LID, menção e resposta à Hikari',()=>{
    const group='120363123456789@g.us';
    const raw={key:{id:'group1',remoteJid:group,participant:'123@lid',participantAlt:'5511888888888@s.whatsapp.net'},pushName:'Ana',message:{extendedTextMessage:{text:'qual o preço?',contextInfo:{mentionedJid:['5511777777777@s.whatsapp.net'],participant:'5511777777777@s.whatsapp.net',quotedMessage:{conversation:'oi'}}}}};
    const msg=normalizeIncoming(raw,x=>x,{botJids:['5511777777777:1@s.whatsapp.net']});
    assert.equal(msg.chatId,group);assert.equal(msg.senderId,'5511888888888@s.whatsapp.net');assert.equal(msg.isGroup,true);assert.equal(msg.isBotMentioned,true);assert.equal(msg.isReplyToBot,true);
    assert.equal(normalizeIncoming({key:{id:'x',remoteJid:group},message:{conversation:'sem remetente'}},x=>x),null);
});

test('grupo registra contexto local e responde só a nome, menção, resposta ou comando',async t=>{
    const f=fixture(t);const group='120363123456789@g.us',sender='5511999999999@s.whatsapp.net';f.store.accept(sender);
    const snapshots=[];let calls=0;
    const router=createRouter({store:f.store,agent:async(prompt,ctx)=>{calls++;snapshots.push({prompt,history:ctx.history});return 'resposta no grupo';}});
    const extra={chatId:group,isGroup:true,senderName:'Ana'};
    await router.handle(f.message('hoje vamos falar de eclipses',extra));assert.equal(calls,0);assert.equal(f.sent.length,0);
    await router.handle(f.message('Hikari, explique um eclipse',extra));assert.equal(calls,1);assert.match(snapshots[0].history[0].content,/eclipses/);assert.match(snapshots[0].prompt,/Ana/);
    await router.handle(f.message('continue',{...extra,isBotMentioned:true}));
    await router.handle(f.message('por quê?',{...extra,isReplyToBot:true}));assert.equal(calls,3);
    assert.equal(f.store.history(sender).length,0);assert.ok(f.store.history(group).length>0);
});

test('contexto enviado à IA contém no máximo 14 anteriores mais a mensagem atual',async t=>{
    const f=fixture(t);const sender='5511999999999@s.whatsapp.net';f.store.accept(sender);
    for(let i=0;i<20;i++)f.store.addHistory(sender,'user',`mensagem ${i}`);
    const router=createRouter({store:f.store,agent:async(prompt,ctx)=>{assert.equal(ctx.history.length,14);assert.equal(ctx.history[0].content,'mensagem 6');return 'resposta';}});
    await router.handle(f.message('mensagem atual'));assert.equal(f.store.history(sender).length,15);assert.equal(f.store.history(sender).at(-1).content,'resposta');
});

test('comandos antigos de memória não chamam ferramentas e placeholder não é dono',async t=>{
    const f=fixture(t);f.store.accept('5511999999999@s.whatsapp.net');let calls=0;
    const router=createRouter({store:f.store,executeTool:async()=>{calls++;}});
    for(const text of ['>lembrar cor | azul','>memoria cor','>editar cor | verde','>esquecer cor'])await router.handle(f.message(text));
    assert.equal(calls,0);assert.equal(config.ownerNumbers.includes('5500000000000'),false);
});

test('campos PN/LID reais do Baileys 6 identificam o dono e preservam o chat do grupo',()=>{
    const group='120363123456789@g.us';
    const normalized=normalizeIncoming({key:{id:'pn',remoteJid:group,participant:'12345@lid',participantPn:'5511888888888@s.whatsapp.net'},message:{conversation:'Hikari'}} ,x=>x);
    assert.equal(normalized.senderId,'5511888888888@s.whatsapp.net');assert.equal(normalized.chatId,group);
    const direct=normalizeIncoming({key:{id:'pn2',remoteJid:'12345@lid',senderPn:'5511888888888@s.whatsapp.net'},message:{conversation:'oi'}},x=>x);
    assert.equal(direct.senderId,'5511888888888@s.whatsapp.net');assert.equal(direct.chatId,'5511888888888@s.whatsapp.net');
});

test('mensagem iniciada com ponto aciona sintese de voz e envia somente audio sem texto duplicado', async t => {
    const f = fixture(t);
    const audioCalls = [];
    const router = createRouter({
        store: f.store,
        agent: async (prompt, ctx) => {
            assert.equal(prompt, 'canta uma musica');
            assert.equal(ctx.wantsAudio, true);
            return 'musica cantada';
        },
        executeTool: async (name, args, ctx) => {
            if (name === 'send_voice_note') {
                audioCalls.push(args.text);
                await ctx.send({audio: Buffer.from('audio'), ptt: true});
                return {ok: true, message: 'Mensagem de voz enviada.'};
            }
            return {ok: true};
        }
    });
    await router.handle(f.message('.canta uma musica'));
    assert.deepEqual(audioCalls, ['musica cantada']);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].ptt, true);
    assert.equal(f.sent[0].text, undefined);
});

test('vazamento de tool_code e default_api e capturado, parseado e limpo sem expor codigo', () => {
    const sample = `tool_code\nprint(default_api.download_video(url='https://www.instagram.com/reels/DfA3Uz1hGzZ/'))`;
    const parsed = extractPseudoToolCalls(sample, schemas);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].function.name, 'download_video');
    assert.deepEqual(JSON.parse(parsed[0].function.arguments), {url: 'https://www.instagram.com/reels/DfA3Uz1hGzZ/'});
    assert.equal(stripThinking(sample), '');
    assert.equal(stripThinking("Aqui esta:\ntool_code\nprint(default_api.download_video(url='https://...'))"), 'Aqui esta:');
});

test('midia enviada nao envia mensagem separada e nao polui historico com brackets', async t => {
    const f = fixture(t);
    const imgFile = path.join(f.dir, 'test.png');
    fs.writeFileSync(imgFile, Buffer.from('img'));
    const router = createRouter({
        store: f.store,
        agent: async (prompt, ctx, exec) => {
            await exec('generate_image', {prompt: 'paisagem'}, ctx);
            return 'aqui esta sua imagem';
        },
        executeTool: createToolExecutor({
            image: async () => ({localFilePath: imgFile})
        })
    });
    const msg = f.message('gera imagem');
    await router.handle(msg);
    assert.equal(f.sent.length, 1);
    assert.ok(f.sent[0].image);
    assert.equal(f.sent[0].caption, 'paisagem');
    assert.ok(f.store.history(msg.chatId).every(m => !/\[Hikari enviou/i.test(m.content)));
});

test('comando view reenvia midia citada e suporta flag oculta dm em grupos com exclusao', async t => {
    const f = fixture(t);
    const router = createRouter({store:f.store});
    const fakeBuffer = Buffer.from('img-bytes');
    const groupMsg = f.message('>view', {
        isGroup: true,
        chatId: '120363@g.us',
        senderId: '5511999999999@s.whatsapp.net',
        hasMedia: true,
        getMedia: async () => ({buffer: fakeBuffer, type: 'image', mimetype: 'image/jpeg'})
    });
    await router.handle(groupMsg);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0].image, fakeBuffer);

    f.sent.length = 0;
    let deletedCount = 0;
    const dmGroupMsg = f.message('>view <dm>', {
        isGroup: true,
        chatId: '120363@g.us',
        senderId: '5511999999999@s.whatsapp.net',
        hasMedia: true,
        getMedia: async () => ({buffer: fakeBuffer, type: 'image', mimetype: 'image/jpeg'}),
        delete: async () => { deletedCount++; return true; }
    });
    await router.handle(dmGroupMsg);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].targetJid, '5511999999999@s.whatsapp.net');
    assert.equal(deletedCount, 1);

    f.sent.length = 0;
    deletedCount = 0;
    const textGroupMsg = f.message('>view dm', {
        isGroup: true,
        chatId: '120363@g.us',
        senderId: '5511999999999@s.whatsapp.net',
        quotedText: 'mensagem de texto citada',
        delete: async () => { deletedCount++; return true; }
    });
    await router.handle(textGroupMsg);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].text, 'mensagem de texto citada');
    assert.equal(f.sent[0].targetJid, '5511999999999@s.whatsapp.net');
    assert.equal(deletedCount, 1);

    f.sent.length = 0;
    const stickerMsg = f.message('>view', {
        isGroup: false,
        chatId: '5511999999999@s.whatsapp.net',
        senderId: '5511999999999@s.whatsapp.net',
        hasMedia: true,
        getMedia: async () => ({buffer: fakeBuffer, type: 'sticker', mimetype: 'image/webp'})
    });
    await router.handle(stickerMsg);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(f.sent[0].sticker, fakeBuffer);
});


