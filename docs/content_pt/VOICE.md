# 🎙️ Sistema Vocal, Transcrição (STT) e Síntese Neural (TTS)

A HikariZap dispõe de recursos completos de voz: transcreve mensagens de áudio recebidas sob demanda via Whisper e responde aos usuários com áudios falados naturalmente no WhatsApp.

---

## 📂 Sumário

1. [👂 1. Transcrição de Áudio sob Demanda (STT Whisper)](#-1-transcrição-de-áudio-sob-demanda-stt-whisper)
2. [🗣️ 2. Síntese Vocal Neural e Respostas em Áudio (TTS)](#-2-síntese-vocal-neural-e-respostas-em-áudio-tts)
3. [🚀 3. Tutorial: Hospedagem TTS no Modal.com (NVIDIA T4 Serverless)](#-3-tutorial-hospedagem-tts-no-modalcom-nvidia-t4-serverless)
4. [🤗 4. Tutorial: Hospedagem TTS no Hugging Face Spaces](#-4-tutorial-hospedagem-tts-no-hugging-face-spaces)
5. [⚙️ 5. Configurações no .env](#-5-configurações-no-env)
6. [💡 Dicas de Especialista](#-dicas-de-especialista)

---

## 👂 1. Transcrição de Áudio sob Demanda (STT Whisper)

Ao citar ou encaminhar um áudio com o comando `>transcrever`, o módulo `src/services/sttService.js` entra em ação:

### Ordem de Fallback do STT:
1. **Groq Cloud (Whisper Turbo):** Se configurado `GROQ_API_KEY`, utiliza o modelo `whisper-large-v3-turbo` na infraestrutura de LPU da Groq, transcrevendo em menos de 800 milissegundos.
2. **Wit.ai (Meta):** Fallback gratuito e de alta velocidade via token `WITAI_TOKEN`.
3. **OpenAI Oficial:** Acionado se configurado `OPENAI_STT_KEY`.
4. **Hugging Face / Servidor Local:** Se configurado `HF_STT_URL` ou `LOCAL_STT_URL`.

### Download Seguro Anti-403:
O download de áudios hospedados em servidores de mídia do WhatsApp implementa User-Agent moderno e cabeçalhos adequados para evitar bloqueios HTTP 403.

---

## 🗣️ 2. Síntese Vocal Neural e Respostas em Áudio (TTS)

A Hikari pode responder diretamente com notas de voz no WhatsApp utilizando o comando `>audio <pergunta>` ou a ferramenta `text_to_speech`:

- **Formato Nativo WhatsApp (PTT):** O áudio é sintetizado em WAV, convertido para Opus em container OGG e transmitido com a flag `ptt: true` do Baileys, exibindo o microfone verde oficial de nota de voz gravada.
- **Voz Neural Expressiva:** Utiliza o modelo XTTS v2 treinado para português brasileiro, mantendo entonação rica e naturalidade de conversa humana.
- **Controle Dinâmico:** Os parâmetros `VOICE_SPEED` (velocidade), `VOICE_TEMPERATURE` (variação de tom) e `VOICE_MAX_CHARS` (limite de caracteres) asseguram estabilidade e evitam sínteses excessivamente longas.

---

## 🚀 3. Tutorial: Hospedagem TTS no Modal.com (NVIDIA T4 Serverless)

O [Modal.com](https://modal.com/) permite rodar o XTTS v2 em GPUs NVIDIA T4 pagando apenas pelos segundos exatos de síntese, desligando a máquina em momentos de ociosidade:

### 1. Instalar a CLI do Modal e Autenticar
```bash
pip install modal
modal setup
```

### 2. Código do Servidor Modal (`modal_app.py`)
```python
import os
import io
import modal
import numpy as np
import soundfile as sf
import torch

app = modal.App("hikari-voice-tts")

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg", "git")
    .pip_install(
        "torch",
        "torchaudio",
        "soundfile",
        "numpy",
        "TTS",
        "fastapi[standard]"
    )
    .copy_local_file("voz_hikari.pth", "/root/voz_hikari.pth")
)

@app.cls(gpu="T4", image=image, scaled_down_window=300)
class TTSService:
    @modal.enter()
    def load_model(self):
        os.environ["COQUI_TOS_AGREED"] = "1"
        from TTS.api import TTS
        self.tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
        dados = torch.load("/root/voz_hikari.pth", map_location="cpu")
        self.cond_latent = dados["gpt_cond_latent"].to("cuda")
        self.speaker_emb = dados["speaker_embedding"].to("cuda")

    @modal.fastapi_endpoint(method="POST")
    def synthesize(self, payload: dict):
        from fastapi.responses import Response, JSONResponse

        text = payload.get("text", "")
        speed = float(payload.get("speed", 1.15))
        temperature = float(payload.get("temperature", 0.65))

        if not text:
            return JSONResponse({"error": "Texto ausente"}, status_code=400)

        out = self.tts.synthesizer.tts_model.inference(
            text=text,
            language="pt",
            gpt_cond_latent=self.cond_latent,
            speaker_embedding=self.speaker_emb,
            temperature=temperature,
            speed=speed,
            enable_text_splitting=True
        )

        buffer = io.BytesIO()
        sf.write(buffer, np.array(out["wav"]), 24000, format="WAV")
        buffer.seek(0)
        return Response(content=buffer.read(), media_type="audio/wav")
```

### 3. Fazer o Deploy
```bash
modal deploy modal_app.py
```
Copie a URL retornada e preencha na variável `MODAL_TTS_ENDPOINT` do seu `.env`.

---

## 🤗 4. Tutorial: Hospedagem TTS no Hugging Face Spaces

Você também pode criar um Space no Hugging Face com Gradio e GPU T4:

### Código da Aplicação Gradio (`app.py`)
```python
import os
import torch
import numpy as np
import soundfile as sf
import gradio as gr
from TTS.api import TTS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "voz_hikari.pth")

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")

latents_data = torch.load(MODEL_PATH, map_location="cpu")
cond_latent = latents_data["gpt_cond_latent"].to("cuda")
speaker_emb = latents_data["speaker_embedding"].to("cuda")

def synthesize(text, speed=1.15, temperature=0.65):
    if not text or len(text.strip()) == 0:
        return None

    out = tts.synthesizer.tts_model.inference(
        text=text,
        language="pt",
        gpt_cond_latent=cond_latent,
        speaker_embedding=speaker_emb,
        temperature=temperature,
        speed=speed,
        enable_text_splitting=True
    )

    out_path = os.path.join(BASE_DIR, "output.wav")
    sf.write(out_path, np.array(out["wav"]), 24000, format="WAV")
    return out_path

with gr.Blocks(title="Hikari Voice TTS") as demo:
    t_in = gr.Textbox(label="Texto")
    s_in = gr.Slider(0.8, 1.5, value=1.15, label="Velocidade")
    tmp_in = gr.Slider(0.4, 0.9, value=0.65, label="Temperatura")
    btn = gr.Button("Sintetizar")
    a_out = gr.Audio(label="Áudio", type="filepath")

    btn.click(
        synthesize,
        inputs=[t_in, s_in, tmp_in],
        outputs=[a_out],
        api_name="synthesize"
    )

demo.launch(server_name="0.0.0.0", server_port=7860)
```

Depois de publicado, preencha o link do Space na variável `HF_TTS_ENDPOINT` do `.env`.

---

## ⚙️ 5. Configurações no .env

```env
GROQ_API_KEY=gsk_sua_chave_groq_aqui
WITAI_TOKEN=seu_token_witai_aqui

MODAL_TTS_ENDPOINT=https://seu-usuario--hikari-voice-tts-ttsservice-synthesize.modal.run
HF_TTS_ENDPOINT=
VOICE_SPEED=1.15
VOICE_TEMPERATURE=0.65
VOICE_MAX_CHARS=1000
```

---

## 💡 Dicas de Especialista

- 💡 **Áudios Curtos e Diretos:** Configure `VOICE_MAX_CHARS=600` para garantir respostas em áudio dinâmicas e de rápida audição pelos membros de grupos.
- 💡 **Fallback Whisper Automático:** Se você configurar tanto `GROQ_API_KEY` quanto `WITAI_TOKEN`, a Hikari usará a Groq primeiro e recorrerá à Wit.ai caso a Groq atinja o limite de requisições.

---

[🏠 Voltar ao Menu Principal](./README.md)

