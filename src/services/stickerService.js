const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const {run} = require('./mediaService');

const SIZE = 512;
const ANIMATED_LIMIT = 500 * 1024;
const STATIC_LIMIT = 100 * 1024;
const DESCRIPTION_LIMIT = 128;
function withDescription(webp, text) {
    const description = Array.from(String(text || '').trim()).slice(0,DESCRIPTION_LIMIT).join('');
    if (!description) return webp;
    const metadata = Buffer.from(JSON.stringify({
        'sticker-pack-id':'hikari-zap',
        'sticker-pack-name':description,
        'sticker-pack-publisher':'Hikari',
        emojis:[]
    }),'utf8');
    const tiff = Buffer.from('49492a0008000000010041570700000000001a00000000000000','hex');
    tiff.writeUInt32LE(metadata.length,14);
    function chunk(name, data) {
        const header = Buffer.alloc(8);
        header.write(name,0,4,'ascii'); header.writeUInt32LE(data.length,4);
        return Buffer.concat([header,data,...(data.length%2 ? [Buffer.alloc(1)] : [])]);
    }
    const chunks = [];
    let extended = false;
    let alpha = false;
    for (let offset=12;offset+8<=webp.length;) {
        const name = webp.toString('ascii',offset,offset+4);
        const length = webp.readUInt32LE(offset+4);
        const end = offset+8+length+(length%2);
        if (end>webp.length) throw new Error('Figurinha WebP inválida.');
        const data = Buffer.from(webp.subarray(offset+8,offset+8+length));
        if (name==='VP8X') { data[0] |= 0x08; extended = true; }
        if (name==='ALPH') alpha = true;
        if (name!=='EXIF') chunks.push(chunk(name,data));
        offset=end;
    }
    if (!extended) {
        const data = Buffer.alloc(10);
        data[0] = 0x08 | (alpha ? 0x10 : 0);
        data.writeUIntLE(SIZE-1,4,3); data.writeUIntLE(SIZE-1,7,3);
        chunks.unshift(chunk('VP8X',data));
    }
    chunks.push(chunk('EXIF',Buffer.concat([tiff,metadata])));
    const body = Buffer.concat([Buffer.from('WEBP'),...chunks]);
    const header = Buffer.alloc(8);
    header.write('RIFF'); header.writeUInt32LE(body.length,4);
    return Buffer.concat([header,body]);
}
function validate(media, types) {
    if (!media || !types.includes(media.type)) throw new Error(types.includes('sticker')
        ? 'Responda a uma figurinha com >sticker2image.'
        : 'Envie ou cite uma imagem, GIF ou vídeo com >sticker.');
    if (!Buffer.isBuffer(media.buffer) || !media.buffer.length) throw new Error('Mídia vazia.');
    if (media.buffer.length > config.maxMediaBytes) throw new Error('Anexo acima do limite de mídia.');
}
async function toSticker(media, signal, description = '') {
    validate(media, ['image','video']);
    signal?.throwIfAborted();
    const animated = media.type === 'video' || media.mimetype === 'image/gif' || media.buffer.subarray(0,3).toString() === 'GIF';
    if (!animated) {
        for (const quality of [75,60,40,20]) {
            const encoded = await sharp(media.buffer, {limitInputPixels:40000000}).rotate()
                .resize(SIZE,SIZE,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality}).toBuffer();
            const buffer = withDescription(encoded,description);
            signal?.throwIfAborted();
            if (buffer.length <= STATIC_LIMIT) return buffer;
        }
        throw new Error('A figurinha ultrapassou 100 KB; tente outra imagem.');
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-sticker-'));
    try {
        const input = path.join(directory,'input');
        const output = path.join(directory,'sticker.webp');
        fs.writeFileSync(input,media.buffer);
        for (const [fps,quality] of [[15,60],[12,45],[10,30],[8,20]]) {
            signal?.throwIfAborted();
            await run(config.ffmpegPath || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-t','10','-i',input,
                '-vf',`fps=${fps},scale=w='iw*sar':h=ih,setsar=1,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0`,
                '-c:v','libwebp','-q:v',String(quality),'-loop','0','-an',output], {signal,timeout:30000});
            const buffer = withDescription(fs.readFileSync(output),description);
            if (buffer.length <= ANIMATED_LIMIT) return buffer;
        }
        throw new Error('A figurinha animada ultrapassou 500 KB; tente um trecho mais curto ou simples.');
    } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw error;
        if (error.code === 'ENOENT') throw new Error('Configure o FFmpeg para criar figurinhas de GIFs e vídeos.');
        throw new Error(`Não foi possível criar a figurinha animada. ${error.message}`);
    } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
async function stickerToImage(media, signal) {
    validate(media,['sticker']);
    signal?.throwIfAborted();
    const metadata = await sharp(media.buffer,{limitInputPixels:40000000}).metadata();
    const animated = metadata.pages > 1;
    const pipeline = sharp(media.buffer,{animated,limitInputPixels:40000000})
        .flatten({background:'#ffffff'});
    const buffer = await (animated ? pipeline.gif({loop:0,keepDuplicateFrames:true}) : pipeline.png()).toBuffer();
    signal?.throwIfAborted();
    if (buffer.length > config.maxMediaBytes) throw new Error('Imagem acima do limite de envio.');
    return buffer;
}
module.exports = {toSticker,stickerToImage};
