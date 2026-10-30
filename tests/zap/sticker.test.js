const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const sharp = require('sharp');
const config = require('../../src/config');
const {toSticker,stickerToImage} = require('../../src/services/stickerService');
const {run} = require('../../src/services/mediaService');
const {normalizeIncoming} = require('../../src/whatsapp/client');
const {createRouter} = require('../../src/whatsapp/router');
const {Store} = require('../../src/whatsapp/store');
const axios = require('axios');
const {createToolExecutor} = require('../../src/whatsapp/tools');

test('conversa sobre figurinha citada recebe contexto visual e responde normalmente',async()=>{
    const buffer=await sharp({create:{width:32,height:32,channels:3,background:'red'}}).webp().toBuffer();
    const sent=[];
    const router=createRouter({store:{seen:()=>false,history:()=>[],addHistory:()=>{}},describe:async media=>{
        assert.equal(media.mimetype,'image/png');
        assert.equal((await sharp(media.buffer).metadata()).format,'png');
        return 'Um quadrado vermelho';
    },agent:async prompt=>{assert.match(prompt,/vermelho/);assert.match(prompt,/gostei/);return 'Que bom que gostou!';}});
    await router.handle({id:'sticker-chat',text:'gostei dessa',chatId:'123@g.us',senderId:'5511999999999@s.whatsapp.net',isGroup:true,isReplyToBot:true,hasMedia:true,getMedia:async()=>({type:'sticker',buffer,mimetype:'image/webp'}),send:async payload=>sent.push(payload)});
    assert.deepEqual(sent,[{text:'Que bom que gostou!'}]);
});

test('normaliza figurinha citada e GIF do WhatsApp como vídeo', () => {
    const key = {id:'1',remoteJid:'5511999999999@s.whatsapp.net'};
    const sticker = {mimetype:'image/webp',isAnimated:true};
    const msg = normalizeIncoming({key,message:{extendedTextMessage:{text:'>sticker2image',contextInfo:{quotedMessage:{stickerMessage:sticker}}}}},x=>x);
    assert.equal(msg.mediaType,'sticker');
    assert.equal(msg.mediaNode,sticker);
    const gif = normalizeIncoming({key,message:{videoMessage:{caption:'>sticker',gifPlayback:true}}},x=>x);
    assert.equal(gif.mediaType,'video');
    assert.equal(gif.text,'>sticker');
});

test('imagem vira WebP 512x512 e figurinha volta a PNG', async () => {
    const input = await sharp({create:{width:80,height:40,channels:4,background:'#ff000080'}}).png().toBuffer();
    const webp = await toSticker({type:'image',mimetype:'image/png',buffer:input});
    const meta = await sharp(webp).metadata();
    assert.equal(meta.width,512); assert.equal(meta.height,512);
    assert.ok(webp.length <= 100*1024);
    const png = await stickerToImage({type:'sticker',buffer:webp});
    assert.equal((await sharp(png).metadata()).format,'png');
    const pixel = await sharp(png).extract({left:256,top:256,width:1,height:1}).removeAlpha().raw().toBuffer();
    assert.ok(pixel[0]>240 && pixel[1]>100 && pixel[1]<160);
});

test('imagem horizontal e vertical preservam proporções e bordas com margens transparentes',async()=>{
    for(const [width,height] of [[100,50],[50,100]]) {
        const input=await sharp({create:{width,height,channels:4,background:'red'}})
            .composite([{input:await sharp({create:{width:10,height,channels:4,background:'blue'}}).png().toBuffer(),left:width-10,top:0}]).png().toBuffer();
        const webp=await toSticker({type:'image',buffer:input});
        const {data,info}=await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        const pixel=(x,y)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)];
        assert.equal(pixel(0,0)[3],0);
        if(width>height) {
            assert.ok(pixel(5,256)[0]>200);assert.ok(pixel(507,256)[2]>200);
            assert.equal(pixel(256,120)[3],0);assert.ok(pixel(256,140)[3]>200);
        } else {
            assert.equal(pixel(120,256)[3],0);assert.ok(pixel(140,256)[3]>200);
            assert.ok(pixel(380,256)[2]>200);
        }
    }
});

test('vídeo e GIF viram figurinhas animadas e retornam GIF com todos os quadros e tempos', async t => {
    if (spawnSync(config.ffmpegPath,['-version'],{stdio:'ignore'}).status !== 0) return t.skip('FFmpeg indisponível');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-sticker-test-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    for (const ext of ['mp4','gif']) {
        const file = path.join(dir,`input.${ext}`);
        await run(config.ffmpegPath,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=duration=1:size=96x64:rate=10',file]);
        const webp = await toSticker({type:ext==='mp4'?'video':'image',mimetype:ext==='gif'?'image/gif':'video/mp4',buffer:fs.readFileSync(file)},undefined,'Animação de teste');
        const meta = await sharp(webp,{animated:true}).metadata();
        assert.equal(meta.width,512); assert.equal(meta.pageHeight,512);
        assert.ok(meta.pages>1); assert.ok(webp.length<=500*1024);
        assert.equal(readDescription(webp),'Animação de teste');
        const first=await sharp(webp,{page:0,pages:1}).ensureAlpha().raw().toBuffer();
        assert.equal(first[3],0);
        const gif = await stickerToImage({type:'sticker',buffer:webp});
        const restored = await sharp(gif,{animated:true}).metadata();
        assert.equal(restored.format,'gif');
        assert.equal(restored.pageHeight,512);
        assert.equal(restored.pages,meta.pages);
        assert.ok(Math.abs(restored.delay.reduce((a,b)=>a+b,0)-meta.delay.reduce((a,b)=>a+b,0))<=meta.pages*10);
    }
});

function readDescription(webp) {
    assert.equal(webp.readUInt32LE(4),webp.length-8);
    for(let offset=12;offset+8<=webp.length;) {
        const length=webp.readUInt32LE(offset+4);
        if(webp.toString('ascii',offset,offset+4)==='EXIF') {
            const tiff=webp.subarray(offset+8,offset+8+length);
            const start=tiff.readUInt32LE(18),size=tiff.readUInt32LE(14);
            return JSON.parse(tiff.subarray(start,start+size).toString())['sticker-pack-name'];
        }
        offset+=8+length+(length%2);
    }
    return undefined;
}

test('descrição fica nos metadados, corta em 128 caracteres e preserva Unicode', async () => {
    const input=await sharp({create:{width:40,height:40,channels:3,background:'red'}}).png().toBuffer();
    const media={type:'image',buffer:input};
    for(const text of ['Minha figurinha favorita','😀'.repeat(130)]) {
        const webp=await toSticker(media,undefined,text);
        assert.equal(readDescription(webp),Array.from(text).slice(0,128).join(''));
        assert.equal((await sharp(webp).metadata()).width,512);
        assert.ok(webp.length<=100*1024);
    }
    assert.equal(readDescription(await toSticker(media)),undefined);
});

test('rejeita mídia incorreta, corrompida e operação cancelada', async () => {
    await assert.rejects(toSticker(null),/Envie ou cite/);
    await assert.rejects(stickerToImage({type:'image',buffer:Buffer.from('x')}),/figurinha/);
    await assert.rejects(toSticker({type:'image',buffer:Buffer.from('inválido')}));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(toSticker({type:'image',buffer:Buffer.from('x')},controller.signal),{name:'AbortError'});
});

test('comandos enviam somente a mídia e não acionam a IA', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-sticker-router-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const sent=[],calls=[],reactions=[];
    const router = createRouter({store:new Store(dir),agent:async()=>assert.fail('IA acionada'),stickerService:{
        toSticker:async (media,signal,description)=>{calls.push(media.type);assert.equal(description,'Minha descrição');return Buffer.from('webp');},
        stickerToImage:async media=>{calls.push(media.type);return Buffer.from('png');}
    }});
    for (const [i,text] of ['>sticker Minha descrição','>sticker2image','>figurinha Minha descrição','>toimg'].entries()) {
        await router.handle({id:String(i),chatId:'123@g.us',isGroup:true,senderId:'5511999999999@s.whatsapp.net',text,
            hasMedia:true,getMedia:async()=>({type:i%2?'sticker':'image'}),
            send:async payload=>sent.push(payload),react:async emoji=>reactions.push(emoji)});
    }
    assert.deepEqual(calls,['image','sticker','image','sticker']);
    assert.equal(sent.length,4);
    assert.ok(sent[0].sticker); assert.ok(sent[1].image);
    assert.deepEqual(reactions,['✂️','','🖼️','','✂️','','🖼️','']);
});

test('pedido natural cria figurinha da imagem citada sem visão externa nem resposta duplicada',async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hikari-sticker-natural-'));
    const original=axios.post,local=config.localLlmEnabled;
    t.after(()=>{axios.post=original;config.localLlmEnabled=local;fs.rmSync(directory,{recursive:true,force:true});});
    config.localLlmEnabled=true;
    let calls=0;
    axios.post=async(url,payload)=>{
        calls++;assert.ok(payload.tools.some(x=>x.function.name==='create_sticker'));
        return {data:{choices:[{message:{content:null,tool_calls:[{id:'sticker1',type:'function',function:{name:'create_sticker',arguments:'{}'}}]}}]}};
    };
    const media={type:'image',buffer:Buffer.from('cited-image')},sent=[];
    const execute=createToolExecutor({sticker:async received=>{assert.equal(received,media);return Buffer.from('webp');}});
    const router=createRouter({store:new Store(directory),executeTool:execute,describe:async()=>assert.fail('Não deve depender de visão para criar figurinha')});
    await router.handle({id:'1',text:'faz essa figurinha aqui',chatId:'123@g.us',senderId:'5511999999999@s.whatsapp.net',isGroup:true,hasMedia:true,getMedia:async()=>media,send:async payload=>sent.push(payload)});
    assert.equal(sent.length,1);assert.ok(sent[0].sticker);
    assert.ok(calls>=1);
});
