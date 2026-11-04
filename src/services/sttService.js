const {logger} = require('../utils/logger');
const axios = require("axios");

const FormData = require("form-data");

const config = require("../config");

const STT_PROVIDERS_CONFIG = {
    GROQ: true,
    WITAI: true,
    GEMINI: true,
    HUGGINGFACE: true,
    OPENAI: true,
    LOCAL: true
};

function isPlaceholderKey(key) {
    if (!key || typeof key !== "string") return true;
    const k = key.toLowerCase().trim();
    return k.includes("sua_chave") || k.includes("suas_chave") || k.includes("seu_token") || k.includes("your_key") || k.includes("placeholder") || k.length < 10;
}

async function transcribeWithGroq(audioBuffer, apiKey, filename, signal) {
    const formData = new FormData;
    formData.append("file", audioBuffer, {
        filename: filename,
        contentType: "audio/wav"
    });
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("language", "pt");
    formData.append("response_format", "json");
    formData.append("prompt", "Hikari, assistente virtual Hikari, fale com a Hikari.");
    const response = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", formData, {
        headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${apiKey}`
        },
        timeout: 1e4,
        signal
    });
    if (response.data && response.data.text) {
        return response.data.text.trim();
    }
    return null;
}

async function transcribeWithGemini(audioBuffer, signal) {
    return require('./aiProviders').getPool().generateGemini({
        contents:[{parts:[{text:'Transcreva exatamente o áudio em português fornecido. Retorne APENAS o texto falado, sem saudações ou comentários.'},{inlineData:{mimeType:'audio/wav',data:audioBuffer.toString('base64')}}]}]
    },signal);
}

async function transcribeWithWitAi(audioBuffer, token, signal) {
    const response = await axios.post("https://api.wit.ai/speech?v=20230215", audioBuffer, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "audio/wav"
        },
        timeout: 1e4,
        signal
    });
    const rawData = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const matches = rawData.match(/\{[\s\S]*?\}(?=\s*\{|$)/g);
    if (matches && matches.length > 0) {
        for (let i = matches.length - 1; i >= 0; i--) {
            try {
                const parsed = JSON.parse(matches[i]);
                if (parsed.text && parsed.text.trim()) {
                    return parsed.text.trim();
                }
            } catch (_) {}
        }
    }
    return null;
}

async function transcribeWithHuggingFace(audioBuffer, token, signal) {
    const endpoint = process.env.HF_STT_URL || "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo";
    const response = await axios.post(endpoint, audioBuffer, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "audio/wav"
        },
        timeout: 12e3,
        signal
    });
    if (response.data && response.data.text) {
        return response.data.text.trim();
    }
    return null;
}

async function transcribeWithOpenAI(audioBuffer, apiKey, filename, signal) {
    const formData = new FormData;
    formData.append("file", audioBuffer, {
        filename: filename,
        contentType: "audio/wav"
    });
    formData.append("model", "whisper-1");
    formData.append("language", "pt");
    formData.append("response_format", "json");
    formData.append("prompt", "Hikari, assistente virtual Hikari, fale com a Hikari.");
    const endpoint = process.env.OPENAI_STT_URL || "https://api.openai.com/v1/audio/transcriptions";
    const response = await axios.post(endpoint, formData, {
        headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${apiKey}`
        },
        timeout: 12e3,
        signal
    });
    if (response.data && response.data.text) {
        return response.data.text.trim();
    }
    return null;
}

async function transcribeWithLocal(audioBuffer, localUrl, filename, signal) {
    const formData = new FormData;
    formData.append("file", audioBuffer, {
        filename: filename,
        contentType: "audio/wav"
    });
    formData.append("language", "pt");
    const headers = {
        ...formData.getHeaders()
    };
    if (process.env.LMSTUDIO_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.LMSTUDIO_API_KEY}`;
    }
    const response = await axios.post(localUrl, formData, {
        headers: headers,
        timeout: 15e3,
        signal
    });
    if (response.data && response.data.text) {
        return response.data.text.trim();
    }
    return null;
}

async function transcribeAudio(audioBuffer, filename = "speech.wav", signal) {
    const providers = [];
    const groqKeysRaw = process.env.GROQ_API_KEY || "";
    if (STT_PROVIDERS_CONFIG.GROQ && groqKeysRaw) {
        const keys = groqKeysRaw.split(",").map(k => k.trim()).filter(k => !isPlaceholderKey(k));
        keys.forEach((k, idx) => {
            providers.push({
                name: `Groq (Chave ${idx + 1})`,
                fn: () => transcribeWithGroq(audioBuffer, k, filename, signal)
            });
        });
    }
    const witToken = process.env.WITAI_TOKEN;
    if (STT_PROVIDERS_CONFIG.WITAI && !isPlaceholderKey(witToken)) {
        providers.push({
            name: "Wit.ai",
            fn: () => transcribeWithWitAi(audioBuffer, witToken, signal)
        });
    }
    const geminiKey = (typeof config.getGeminiKey === "function" ? config.getGeminiKey() : null) || process.env.GEMINI_API_KEY;
    if (STT_PROVIDERS_CONFIG.GEMINI && !isPlaceholderKey(geminiKey)) {
        providers.push({
            name: "Gemini Flash Audio (Google API)",
            fn: () => transcribeWithGemini(audioBuffer, signal)
        });
    }
    const hfToken = process.env.HF_TOKEN;
    if (STT_PROVIDERS_CONFIG.HUGGINGFACE && !isPlaceholderKey(hfToken)) {
        providers.push({
            name: "HuggingFace STT",
            fn: () => transcribeWithHuggingFace(audioBuffer, hfToken, signal)
        });
    }
    const openAiKey = process.env.OPENAI_STT_KEY;
    if (STT_PROVIDERS_CONFIG.OPENAI && !isPlaceholderKey(openAiKey)) {
        providers.push({
            name: "OpenAI Whisper",
            fn: () => transcribeWithOpenAI(audioBuffer, openAiKey, filename, signal)
        });
    }
    const localSttUrl = process.env.LOCAL_STT_URL;
    if (STT_PROVIDERS_CONFIG.LOCAL && localSttUrl) {
        providers.push({
            name: "Local Whisper STT",
            fn: () => transcribeWithLocal(audioBuffer, localSttUrl, filename, signal)
        });
    }
    if (providers.length === 0) {
        logger.error("[STT]  Nenhuma chave/provedor de STT válido configurado no .env");
        return null;
    }
    let lastRateLimit = null;
    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        signal?.throwIfAborted();
        try {
            const text = await provider.fn();
            if (text) {
                if (i > 0) {
                    logger.info(`[STT]  Transcrito com sucesso via Fallback: ${provider.name}`);
                }
                return text;
            }
        } catch (error) {
            signal?.throwIfAborted();
            const status = error.response?.status;
            const isRate = status === 429 || status === 492 || error.response?.data?.error?.code === "rate_limit_exceeded";
            if (isRate) {
                lastRateLimit = {
                    isRateLimit: true,
                    status: status,
                    message: error.response?.data?.error?.message || "Rate limit"
                };
            }
            logger.warn(`[STT]  Falha no provedor ${provider.name} (Status: ${status || "Erro de Conexão"}). Tentando próximo fallback...`);
        }
    }
    if (lastRateLimit) {
        logger.error("[STT]  Todos os provedores de STT ativos atingiram limite de requisições.");
        return lastRateLimit;
    }
    return null;
}

module.exports = {
    transcribeAudio: transcribeAudio,
    STT_PROVIDERS_CONFIG: STT_PROVIDERS_CONFIG
};
