const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {safeGet} = require('../utils/network');
const aliases = {'gta v':'grand theft auto v','gta 5':'grand theft auto v','rdr2':'red dead redemption 2','rdr 2':'red dead redemption 2','cod':'call of duty','elder ring':'elden ring','eldenring':'elden ring'};
const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
let catalog;
async function loadCatalog() {
    if (!catalog) catalog = Promise.all(['fitgirl','dodi'].map(async provider => {
        const data = JSON.parse(await fs.readFile(path.join(__dirname,'../data',`${provider}.json`),'utf8'));
        return data.downloads.flatMap(game => {
            const magnet = game.uris?.find(uri=>uri.startsWith('magnet:?'));
            const hash = magnet && new URL(magnet).searchParams.getAll('xt').map(xt=>/^urn:btih:([a-f0-9]{40})$/i.exec(xt)?.[1]).find(Boolean);
            return hash ? [{title:game.title,provider:provider==='fitgirl'?'FitGirl':'DODI',fileSize:String(game.fileSize||'').trim(),magnet,hash:hash.toUpperCase(),normalized:normalize(game.title)}] : [];
        });
    })).then(groups=>groups.flat()).catch(error=>{catalog=null;throw error;});
    return catalog;
}
async function searchGames(query, signal) {
    signal?.throwIfAborted();
    let term=normalize(query);
    term=aliases[term] || term;
    if (!term || term.length>150) throw new Error('Informe um nome de jogo com até 150 caracteres.');
    const words=term.split(' ');
    const games=await loadCatalog();
    signal?.throwIfAborted();
    const seen=new Set();
    return games.filter(game=>words.every(word=>game.normalized.split(' ').includes(word))).sort((a,b)=>
        Number(b.normalized.startsWith(term))-Number(a.normalized.startsWith(term)) || a.normalized.length-b.normalized.length
    ).filter(game=>{if(seen.has(game.hash))return false;seen.add(game.hash);return true;}).slice(0,5);
}

function validateTorrent(buffer, hash) {
    let offset=0,info;
    function parse(depth=0,root=false) {
        if(depth>64 || offset>=buffer.length)throw new Error('Torrent inválido.');
        const start=offset, type=buffer[offset++];
        if(type===100 || type===108) {
            while(offset<buffer.length && buffer[offset]!==101) {
                let key;
                if(type===100) {key=parse(depth+1);if(!Buffer.isBuffer(key))throw new Error('Torrent inválido.');}
                const begin=offset;
                parse(depth+1);
                if(root && key?.toString()==='info') {
                    if(info || buffer[begin]!==100)throw new Error('Torrent inválido.');
                    info=buffer.subarray(begin,offset);
                }
            }
            if(buffer[offset++]!==101)throw new Error('Torrent inválido.');
            return;
        }
        if(type===105) {
            const end=buffer.indexOf(101,offset);
            if(end<0 || !/^-?\d+$/.test(buffer.toString('ascii',offset,end)))throw new Error('Torrent inválido.');
            offset=end+1;return;
        }
        offset=start;
        const colon=buffer.indexOf(58,offset);
        if(colon<0 || colon-offset>10 || !/^\d+$/.test(buffer.toString('ascii',offset,colon)))throw new Error('Torrent inválido.');
        const length=Number(buffer.toString('ascii',offset,colon));
        offset=colon+1+length;
        if(offset>buffer.length)throw new Error('Torrent inválido.');
        return buffer.subarray(colon+1,offset);
    }
    if(buffer[0]!==100)throw new Error('Torrent inválido.');
    parse(0,true);
    if(offset!==buffer.length || !info || createHash('sha1').update(info).digest('hex').toUpperCase()!==hash.toUpperCase())throw new Error('Torrent não corresponde ao magnet.');
    return buffer;
}
async function getTorrentOrMagnet(game, signal, request=safeGet) {
    const stem=game.title.replace(/[^a-z0-9_-]+/gi,'_').slice(0,70) || 'torrent';
    try {
        if(!/^[a-f0-9]{40}$/i.test(game.hash))throw new Error('Hash inválido.');
        const response=await request(`https://itorrents.org/torrent/${game.hash}.torrent`,{signal,responseType:'arraybuffer',timeout:8000,maxContentLength:2*1024*1024});
        signal?.throwIfAborted();
        const buffer=Buffer.from(response.data);
        if(buffer.length>2*1024*1024)throw new Error('Torrent muito grande.');
        validateTorrent(buffer,game.hash);
        return {buffer,fileName:`${stem}.torrent`,mimetype:'application/x-bittorrent',fallback:false};
    } catch(error) {
        if(signal?.aborted || error.name==='AbortError')throw error;
        return {buffer:Buffer.from(game.magnet,'utf8'),fileName:`${stem}_magnet.txt`,mimetype:'text/plain',fallback:true};
    }
}
module.exports={searchGames,getTorrentOrMagnet,validateTorrent};
