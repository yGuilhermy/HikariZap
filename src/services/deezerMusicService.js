const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {run} = require('./mediaService');
const config = require('../config');
async function searchDeezerTracks(query, signal) {
    const response = await axios.get('https://api.deezer.com/search',{params:{q:query},timeout:15000,signal});
    return (response.data?.data || []).slice(0,5).map(x => ({id:x.id,title:x.title,artist:x.artist?.name,link:x.link}));
}
async function downloadDeezerTrack(raw, signal) {
    const match = String(raw).match(/^(?:https:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?track\/)?(\d+)$/);
    if (!match) throw new Error('Faixa Deezer inválida.');
    if (!process.env.DEEZER_ARL) throw new Error('Configure DEEZER_ARL para baixar músicas do Deezer.');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'hikari-deezer-'));
    try {
        await run(config.pythonPath,[path.join(__dirname,'download_deezer.py'),`https://www.deezer.com/track/${match[1]}`,directory],{signal,timeout:120000});
        const files = fs.readdirSync(directory).filter(x => /\.(mp3|flac)$/i.test(x));
        if (!files.length) throw new Error('Nenhum arquivo de áudio retornado pelo Deezer.');
        return path.join(directory,files[0]);
    } catch (error) { fs.rmSync(directory,{recursive:true,force:true}); throw error; }
}
function cleanupTempAudio(file) {
    const directory = path.dirname(file);
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('hikari-deezer-')) throw new Error('Caminho temporário inválido.');
    fs.rmSync(directory,{recursive:true,force:true});
}
module.exports = {searchDeezerTracks,downloadDeezerTrack,cleanupTempAudio};
