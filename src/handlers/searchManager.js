const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const {safeGet} = require('../utils/network');
const {logger} = require('../utils/logger');

function sanitizeFallbackQuery(query) {
    return String(query || '')
        .replace(/^(?:o\s+que\s+(?:tá|está|vem|tem)\s+acontecendo\s+com|oq\s+ta\s+acontecendo\s+com|o\s+que\s+(?:é|são)|oq\s+é|quem\s+é|pesquise\s+(?:sobre|por)?|pesquisa\s+(?:sobre|por)?|procure\s+(?:sobre|por)?)\s+/i, '')
        .replace(/\b(?:atualmente|ultimamente|hoje\s+em\s+dia|no\s+momento)\b/gi, '')
        .trim();
}

function isDictionaryResult(url, title, isDefinitionQuery) {
    if (isDefinitionQuery) return false;
    const host = (url || '').toLowerCase();
    const isDictHost = ['dicio.com.br', 'priberam.org', 'significados.com.br', 'escreva.ai', 'vestibulandoweb.com.br'].some(d => host.includes(d));
    if (isDictHost) return true;
    return /^(?:significado\s+de|o\s+que\s+é\s+tá)\b/i.test(title || '');
}

async function searchWeb(query, signal) {
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Informe uma pesquisa de até 500 caracteres.');
    logger.search(`Buscando na web por: "${query}"`);
    if (config.braveApiKey) {
        try {
            const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
                params: {q: query, count: 5},
                headers: {
                    'X-Subscription-Token': config.braveApiKey,
                    'Accept': 'application/json'
                },
                timeout: 15000,
                signal
            });
            const rows = response.data?.web?.results || [];
            if (rows.length) {
                logger.search(`Busca Brave retornou ${rows.length} resultados para "${query}"`);
                return rows.slice(0, 5).map(x => ({title: x.title, url: x.url, snippet: x.description}));
            }
        } catch { signal?.throwIfAborted(); }
    }
    const cleanQuery = sanitizeFallbackQuery(query) || query;
    const isDefinitionQuery = /\b(significado|definição|definicao|dicionário|dicionario|o\s+que\s+significa)\b/i.test(query);
    for (const [url, selector] of [['https://www.bing.com/search?q=', '.b_algo'], ['https://html.duckduckgo.com/html/?q=', '.result']]) {
        try {
            const response = await safeGet(url + encodeURIComponent(cleanQuery), {signal, headers:{'User-Agent':'Mozilla/5.0'}});
            const $ = cheerio.load(response.data);
            const rows = [];
            $(selector).each((_, item) => {
                const a = $(item).find('h2 a, .result__a').first();
                let link = a.attr('href') || '';
                if (link.startsWith('//')) link = 'https:' + link;
                try {
                    const parsed = new URL(link);
                    if (parsed.searchParams.has('uddg')) link = parsed.searchParams.get('uddg');
                    if (parsed.hostname.endsWith('bing.com') && parsed.searchParams.get('u')?.startsWith('a1')) link = Buffer.from(parsed.searchParams.get('u').slice(2), 'base64').toString();
                    if (!/^https?:\/\//.test(link)) return;
                    const title = a.text().trim();
                    if (isDictionaryResult(link, title, isDefinitionQuery)) return;
                    rows.push({title, url: link, snippet: $(item).find('.b_caption p, .result__snippet').text().trim().slice(0, 1000)});
                } catch {}
            });
            if (rows.length) {
                logger.search(`Busca alternativa retornou ${rows.length} resultados`);
                return rows.slice(0, 5);
            }
        } catch { signal?.throwIfAborted(); }
    }
    logger.search(`Nenhum resultado web encontrado para "${query}"`);
    return [];
}

module.exports = { searchWeb };
