import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { OpenAI } from "openai";
import admin from "firebase-admin";
import { randomUUID } from "crypto";
import { Readable } from "stream";

const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "";
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

if (!admin.apps.length) {
  const init = {
    credential: svcB64
      ? admin.credential.cert(JSON.parse(Buffer.from(svcB64, "base64").toString("utf8")))
      : admin.credential.applicationDefault(),
    storageBucket: bucketName,
  };
  admin.initializeApp(init);
}
const bucket = admin.storage().bucket();

const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("FALTA OPENAI_API_KEY en variables de entorno");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// Health
app.get("/", (req, res) => res.send("Servidor ok 👌"));
app.get("/health", (req, res) => res.json({ ok: true }));

// Chat proxy (opcional)
app.post("/chat", async (req, res) => {
  try {
    const body = req.body;
    const resp = await openai.chat.completions.create(body);
    res.json(resp);
  } catch (err) {
    console.error("chat error", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Transcribe: recibe form-data con campo "audio"
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });

    // Guardamos temporalmente (compatibilidad máxima)
    const tmpDir = path.join(process.cwd(), "tmp_audio");
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, `${Date.now()}-${req.file.originalname || "audio.wav"}`);
    await fs.writeFile(tmpPath, req.file.buffer);

    // Usamos el SDK para enviar el archivo
    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: "whisper-1",
      response_format: "json",
      language: "es"
    });

    // Limpieza
    await fs.unlink(tmpPath).catch(() => null);

    // Normalizamos respuesta
    const text = transcription?.text ?? (transcription?.data?.[0]?.text ?? "");
    res.json({ text });
  } catch (err) {
    console.error("transcribe error:", err?.status || "", err?.message || err);
    // Si viene payload de la API:
    if (err?.response?.data) console.error("openai response:", err.response.data);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// ===== RUNWAY: crear tarea de texto a video =====
app.post("/runway/generate", async (req, res) => {
  try {
    const { prompt, ratio = "16:9", duration = 5, model = "veo3", seed = null } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    const r = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RUNWAY_API_KEY}`,
        "Content-Type": "application/json",
        // Fija versión de API para estabilidad
        "X-Runway-Version": "2024-11-06"
      },
      body: JSON.stringify({
        model,           // p.ej. "veo3"
        promptText: prompt,
        ratio,           // "16:9" | "9:16" | "1:1" | etc.
        duration,        // 5 o 10 (segundos, según el modelo)
        ...(seed != null ? { seed } : {})
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    // data incluye al menos un "id" de tarea
    return res.json(data);
  } catch (e) {
    console.error("runway/generate error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// ===== RUNWAY: consultar estado de la tarea =====
app.get("/runway/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const r = await fetch(`https://api.dev.runwayml.com/v1/tasks/${id}`, {
      headers: {
        "Authorization": `Bearer ${process.env.RUNWAY_API_KEY}`,
        "X-Runway-Version": "2024-11-06"
      }
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error("runway/tasks error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// Guarda un MP4 de Runway en Firebase Storage (privado; sin mostrar)
app.post("/runway/save-to-firebase", async (req, res) => {
  try {
    const { url, meta } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const filename = `runway/${Date.now()}_${Math.random().toString(36).slice(2,8)}.mp4`;
    const file = bucket.file(filename);

    // === SUBIR SIN STREAMS (simple) ===
const resp = await fetch(url);
if (!resp.ok) {
  return res.status(502).json({ error: "Download failed", status: resp.status });
}
const buf = Buffer.from(await resp.arrayBuffer());

await file.save(buf, {
  contentType: "video/mp4",
  metadata: meta
    ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)]))
    : {},
  resumable: false
});


    return res.json({ ok: true, storagePath: filename, bucket: bucket.name });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));