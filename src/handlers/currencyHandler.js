const axios = require('axios');
const config = require('../config');

const nameMap = {
    '$': 'USD',
    'US$': 'USD',
    'U$': 'USD',
    'USD$': 'USD',
    'DOLAR': 'USD',
    'DOLARES': 'USD',
    'DOLAR AMERICANO': 'USD',
    'DOLARES AMERICANOS': 'USD',
    'BUCKS': 'USD',
    'GREENBACK': 'USD',

    'R$': 'BRL',
    'RS': 'BRL',
    'REAL': 'BRL',
    'REAIS': 'BRL',
    'BR': 'BRL',
    'BRL': 'BRL',
    'BRASIL': 'BRL',
    'BRAZIL': 'BRL',
    'CONTO': 'BRL',

    '€': 'EUR',
    'EURO': 'EUR',
    'EUROS': 'EUR',

    '£': 'GBP',
    'LIBRA': 'GBP',
    'LIBRAS': 'GBP',
    'LIBRA ESTERLINA': 'GBP',
    'LIBRAS ESTERLINAS': 'GBP',

    '¥': 'JPY',
    'IENE': 'JPY',
    'IENES': 'JPY',
    'YEN': 'JPY',
    'YENS': 'JPY',

    '₿': 'BTC',
    'BTC': 'BTC',
    'BITCOIN': 'BTC',
    'BITCOINS': 'BTC',

    'ETH': 'ETH',
    'ETHEREUM': 'ETH',
    'ETHER': 'ETH',

    'SOL': 'SOL',
    'SOLANA': 'SOL',

    'USDT': 'USDT',
    'TETHER': 'USDT',

    'DOGE': 'DOGE',
    'DOGECOIN': 'DOGE',

    'LTC': 'LTC',
    'LITECOIN': 'LTC',

    'XRP': 'XRP',
    'RIPPLE': 'XRP',

    'CAD': 'CAD',
    'DOLAR CANADENSE': 'CAD',
    'DOLARES CANADENSES': 'CAD',

    'AUD': 'AUD',
    'DOLAR AUSTRALIANO': 'AUD',
    'DOLARES AUSTRALIANOS': 'AUD',

    'CHF': 'CHF',
    'FRANCO': 'CHF',
    'FRANCO SUICO': 'CHF',
    'FRANCOS SUICOS': 'CHF',

    'CNY': 'CNY',
    'YUAN': 'CNY',
    'YUAN CHINES': 'CNY',
    'YUANS': 'CNY',
    'RENMINBI': 'CNY',

    'ARS': 'ARS',
    'PESO': 'ARS',
    'PESOS': 'ARS',
    'PESO ARGENTINO': 'ARS',
    'PESOS ARGENTINOS': 'ARS',

    'CLP': 'CLP',
    'PESO CHILENO': 'CLP',
    'PESOS CHILENOS': 'CLP',

    'COP': 'COP',
    'PESO COLOMBIANO': 'COP',
    'PESOS COLOMBIANOS': 'COP',

    'MXN': 'MXN',
    'PESO MEXICANO': 'MXN',
    'PESOS MEXICANOS': 'MXN',

    'UYU': 'UYU',
    'PESO URUGUAIO': 'UYU',
    'PESOS URUGUAIOS': 'UYU',

    'RUB': 'RUB',
    'RUBLO': 'RUB',
    'RUBLOS': 'RUB',
    'RUBLO RUSSO': 'RUB',

    'INR': 'INR',
    'RUPIA': 'INR',
    'RUPIAS': 'INR',
    'RUPIA INDIANA': 'INR',

    'KRW': 'KRW',
    'WON': 'KRW',
    'WONS': 'KRW',
    'WON SUL COREANO': 'KRW',

    'TRY': 'TRY',
    'LIRA': 'TRY',
    'LIRAS': 'TRY',
    'LIRA TURCA': 'TRY',

    'NZD': 'NZD',
    'DOLAR NEOZELANDES': 'NZD',

    'SGD': 'SGD',
    'DOLAR DE SINGAPURA': 'SGD',

    'AED': 'AED',
    'DIRHAM': 'AED',

    'SAR': 'SAR',
    'RIYAL': 'SAR',
    'RIYAL SAUDITA': 'SAR',

    'ILS': 'ILS',
    'SHEKEL': 'ILS',
    'NOVO SHEKEL': 'ILS'
};

function normalizeCurrency(raw) {
    if (!raw) return 'BRL';
    let s = String(raw).trim().toUpperCase();
    s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[^A-Z0-9$€£¥₿]/g, ' ').replace(/\s+/g, ' ').trim();
    return nameMap[s] || s;
}

function parseAmount(val) {
    if (typeof val === 'number') return !isNaN(val) && val > 0 ? val : 1;
    if (!val) return 1;
    let s = String(val).trim();
    s = s.replace(/^[^\d.,]+/, '').replace(/[^\d.,]+$/, '');
    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    const num = parseFloat(s);
    return !isNaN(num) && num > 0 ? num : 1;
}

function formatCurrencyNumber(val) {
    const num = Number(val);
    if (isNaN(num)) return '0,00';
    if (num === 0) return '0,00';
    const abs = Math.abs(num);
    if (abs < 0.00001) {
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    }
    if (abs < 0.001) {
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }
    if (abs < 1) {
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCurrencyQuery(text) {
    if (!text || typeof text !== 'string') return { amount: 1, from: 'USD', to: 'BRL' };
    let clean = text.toLowerCase()
        .replace(/(?:converter?|convers[aã]o\s*(?:de)?|transformar?)\s*/gi, '')
        .replace(/cota[çc][aã]o\s*(do|da|de)?/gi, '')
        .replace(/quanto\s*(t[aá]|est[aá]|vale|custa)\s*(o|a|um)?/gi, '')
        .trim();
    let amount = 1;
    const numMatch = clean.match(/^([\d.,]+)\s*/);
    if (numMatch) {
        amount = parseAmount(numMatch[1]);
        clean = clean.substring(numMatch[0].length).trim();
    }
    const splitMatch = clean.split(/\s+(?:para|em|pra|to|->)\s+/i);
    let from = 'USD';
    let to = 'BRL';
    if (splitMatch.length >= 2) {
        from = splitMatch[0].trim();
        to = splitMatch[1].trim();
    } else {
        from = clean.trim() || 'USD';
        to = 'BRL';
    }
    return { amount: parseAmount(amount), from: normalizeCurrency(from), to: normalizeCurrency(to) };
}

function positiveRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Cotação inválida recebida do provedor.');
    return rate;
}
function quoteTime(item) {
    const timestamp = Number(item.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
        const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
        if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    if (typeof item.create_date === 'string' && item.create_date.trim()) return item.create_date;
    throw new Error('Cotação sem data de atualização.');
}
async function awesomeQuote(from, to, signal) {
    const options = {timeout:8000, signal, headers:{'Cache-Control':'no-cache'}};
    if (config.awesomeApiKey) options.headers['x-api-key'] = config.awesomeApiKey;
    async function request(base, quote) {
        const {data} = await axios.get(`https://economia.awesomeapi.com.br/json/last/${base}-${quote}`,options);
        const item = data?.[`${base}${quote}`];
        if (!item || item.code !== base || item.codein !== quote) throw new Error('Par indisponível no provedor.');
        return {rate:positiveRate(item.bid),lastUpdate:quoteTime(item)};
    }
    let quote;
    try { quote = await request(from,to); }
    catch (error) {
        if (signal?.aborted || Number(error.response?.status) !== 404) throw error;
        try {
            const inverse = await request(to,from);
            quote = {...inverse,rate:positiveRate(1/inverse.rate)};
        } catch (inverseError) {
            if (signal?.aborted || Number(inverseError.response?.status) !== 404 || from === 'BRL' || to === 'BRL') throw inverseError;
            const origin = await request(from,'BRL');
            const target = await request(to,'BRL');
            quote = {rate:positiveRate(origin.rate/target.rate),
                lastUpdate:origin.lastUpdate === target.lastUpdate ? origin.lastUpdate : `${from}/BRL: ${origin.lastUpdate}; ${to}/BRL: ${target.lastUpdate}`,
                calculation:'Taxa cruzada via BRL'};
        }
    }
    return {...quote,source:'AwesomeAPI',sourceUrl:'https://docs.awesomeapi.com.br/api-de-moedas',
        frequency:config.awesomeApiKey ? 'Cotação do provedor consultada agora' : 'Provedor pode manter cache de até 1 minuto'};
}
async function frankfurterQuote(from, to, signal) {
    const {data} = await axios.get(`https://api.frankfurter.dev/v2/rate/${from}/${to}`,{timeout:8000,signal});
    if (data?.base !== from || data?.quote !== to || !/^\d{4}-\d{2}-\d{2}$/.test(data?.date || '')) throw new Error('Resposta inválida do provedor.');
    return {rate:positiveRate(data.rate),lastUpdate:data.date,source:'Frankfurter',sourceUrl:'https://frankfurter.dev/',frequency:'Taxa de referência diária; não é cotação em tempo real'};
}
async function convertCurrency(rawAmount, rawFrom, rawTo, signal) {
    const amount = typeof rawAmount === 'number' ? rawAmount : parseAmount(rawAmount);
    const from = normalizeCurrency(rawFrom || 'USD');
    const to = normalizeCurrency(rawTo || 'BRL');
    if (!Number.isFinite(amount) || amount < 0) return {error:'Informe um valor finito maior ou igual a zero.'};
    if (![from,to].every(code=>/^[A-Z]{2,10}$/.test(code))) return {error:'Informe códigos de moeda válidos (ex: USD, EUR, BTC, BRL).'};
    signal?.throwIfAborted();
    if (from === to) return {success:true,amount,from,to,rate:1,result:amount,name:`${from}/${to}`,lastUpdate:'Não se aplica (mesma moeda)',source:'Identidade matemática'};
    try {
        const provider = config.currencyProvider || 'awesomeapi';
        if (!['awesomeapi','frankfurter'].includes(provider)) return {error:'CURRENCY_PROVIDER inválido; use awesomeapi ou frankfurter.'};
        const quote = await (provider === 'frankfurter' ? frankfurterQuote : awesomeQuote)(from,to,signal);
        signal?.throwIfAborted();
        const result = amount * quote.rate;
        if (!Number.isFinite(result)) return {error:'O valor convertido ultrapassou o limite numérico.'};
        return {success:true,amount,from,to,name:`${from}/${to}`,...quote,result,queriedAt:new Date().toISOString()};
    } catch (error) {
        if (signal?.aborted || error.name === 'AbortError' || error.code === 'ERR_CANCELED') throw error;
        if (Number(error.response?.status) === 429) return {error:'O provedor de cotações atingiu seu limite de requisições. Tente novamente mais tarde; nenhuma cotação antiga foi usada.'};
        return {error:`Não foi possível consultar uma cotação atual para ${from}/${to}. O par pode não estar disponível ou o provedor está indisponível; nenhuma cotação antiga foi usada.`};
    }
}
module.exports = {convertCurrency,normalizeCurrency,parseAmount,formatCurrencyNumber,parseCurrencyQuery};
