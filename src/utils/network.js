const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const ipaddr = require('ipaddr.js');
const axios = require('axios');
function publicAddress(address) {
    try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
async function safeGet(raw, options = {}) {
    let url = new URL(raw);
    for (let redirect = 0; redirect <= 3; redirect++) {
        if (!['https:','http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('URL não permitida.');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = net.isIP(host) ? [{address:host, family:net.isIP(host)}] : await dns.lookup(host, {all:true});
        if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('Destino de rede não permitido.');
        const selected = addresses[0];
        const lookup = (_hostname, opts, callback) => callback(null, opts?.all ? [selected] : selected.address, selected.family);
        const agentOptions = {lookup};
        const response = await axios.get(url.toString(), {
            timeout:15000, maxContentLength:10 * 1024 * 1024, ...options,
            maxRedirects:0, proxy:false, validateStatus: status => status >= 200 && status < 400,
            httpAgent:new http.Agent(agentOptions), httpsAgent:new https.Agent(agentOptions)
        });
        if (response.status < 300) return response;
        if (!response.headers.location) throw new Error('Redirecionamento inválido.');
        url = new URL(response.headers.location, url);
    }
    throw new Error('Muitos redirecionamentos.');
}
module.exports = { safeGet, publicAddress };
