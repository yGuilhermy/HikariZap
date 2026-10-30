const axios = require('axios');
async function getAnimeSource(buffer, mimeType = 'image/jpeg', signal) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Envie uma imagem de até 10 MB.');
    const response = await axios.post('https://api.trace.moe/search?anilistInfo', buffer, {
        headers: {'Content-Type': mimeType}, timeout: 30000, maxBodyLength: 10 * 1024 * 1024, signal
    });
    return (response.data?.result || []).slice(0,3).map(x => ({
        title: x.anilist?.title?.romaji || x.anilist?.title?.english || x.filename,
        episode: x.episode, similarity: Math.round(x.similarity * 100), seconds: Math.floor(x.from || 0),
        url: x.anilist?.id ? `https://anilist.co/anime/${x.anilist.id}` : ''
    }));
}
module.exports = { getAnimeSource };
