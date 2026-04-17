import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import admin from "firebase-admin";
import { OpenAI } from "openai";

// módulos nuevos
import { classifyIntent } from "./intentClassifier.js";
import { buildContext } from "./contextAssembler.js";
import { generatePrompt } from "./promptEngineer.js";
import { updateMemory } from "./memoryManager.js";
import { formatResponse } from "./outputFormatter.js";

// ===== INIT =====
const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ===== FIREBASE =====
const svcB64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "";
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: svcB64
      ? admin.credential.cert(JSON.parse(Buffer.from(svcB64, "base64").toString("utf8")))
      : admin.credential.applicationDefault(),
    storageBucket: bucketName
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ===== HEALTH =====
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ ok: true }));

// =======================================================
// 🔥 CORE CHAT ENDPOINT
// =======================================================
app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      sessionId,
      modelId,
      generatorId,
      history = []
    } = req.body;

    if (!message || !sessionId || !modelId || !generatorId) {
      return res.status(400).json({ error: "Missing params" });
    }

    // ===== 1. cargar modelo =====
    const clientDoc = await db.collection("clientes").doc(modelId).get();
    if (!clientDoc.exists) {
      return res.status(404).json({ error: "Client not found" });
    }

    // 🔥 extraer generator desde cliente
    const clientData = clientDoc.data();
    const generator = (clientData.generators || []).find(g => g.id === generatorId);

    if (!generator) {
      return res.status(404).json({ error: "Generator not found" });
    }

    const modelConfig = {
      id: generator.id,
      name: generator.name,
      provider: generator.provider,
      mode: generator.mode,
      promptEngineerSystem: generator.promptEngineerSystem
    };

    // ===== 2. cargar memoria =====
    const memRef = db.collection("sesiones").doc(sessionId).collection("memory").doc("core");
    const memSnap = await memRef.get();
    const sessionMemory = memSnap.exists ? memSnap.data() : {};

    // ===== 3. cargar archivos contexto =====
    const ctxSnap = await db
      .collection("sesiones")
      .doc(sessionId)
      .collection("context_files")
      .get();

    const contextFiles = ctxSnap.docs.map(d => d.data());
    const resolvedFiles = await Promise.all(
      contextFiles.map(async (file) => {
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.storagePath)}?alt=media`;

        // IMÁGENES
        if (file.mimeType.startsWith("image/")) {
          return {
            type: "input_image",
            image_url: url
          };
        }

        // TEXTO SIMPLE
        if (file.mimeType.startsWith("text/")) {
          const text = await fetch(url).then(r => r.text());
          return {
            type: "input_text",
            text: text.slice(0, 4000)
          };
        }

        // fallback (pdf, docx, etc.)
        return {
          type: "input_text",
          text: `[Archivo adjunto: ${file.fileName}]`
        };
      })
    );

    // ===== 4. clasificar intención =====
    const intentData = await classifyIntent(message, history);

    let promptPackage = null;
    let chatText = "";

    // ===== 5. ejecutar lógica =====
    if (intentData.intent === "generate_prompt" || intentData.intent === "refine_prompt") {

      const context = buildContext({
        sessionMemory,
        contextFiles,
        history,
        modelConfig
      });

      promptPackage = await generatePrompt({
        userInput: message,
        modelConfig,
        sessionMemory: context.memory,
        contextFiles: resolvedFiles,
        history: context.history
      });

      if (promptPackage?.error) {
        return res.status(500).json({
          error: "Prompt generation failed"
        });
      }

      chatText = "Prompt generado.";

      // guardar prompt
      await db
        .collection("sesiones")
        .doc(sessionId)
        .collection("prompt_generations")
        .add({
          modelId: modelConfig.id,
          modelName: modelConfig.name,
          provider: modelConfig.provider,
          mode: modelConfig.mode,
          ...promptPackage,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } else {
      // conversación normal
      const response = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: message },
              ...resolvedFiles
            ]
          }
        ]
      });

      chatText = response.output_text || "";
    }

    // ===== 6. actualizar memoria =====
    const newMemory = await updateMemory({
      userMessage: message,
      assistantMessage: chatText,
      currentMemory: sessionMemory
    });

    await memRef.set(newMemory, { merge: true });

    // ===== 8. respuesta final =====
    const response = formatResponse({
      intent: intentData.intent,
      modelConfig,
      promptPackage,
      chatText,
      memoryUpdates: newMemory
    });

    res.json(response);

  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================================================
// 📁 CONTEXT FILE UPLOAD
// =======================================================
app.post("/context/upload", upload.single("file"), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;

    if (!file || !sessionId) {
      return res.status(400).json({ error: "Missing file or sessionId" });
    }

    const filename = `sesiones/${sessionId}/${Date.now()}_${file.originalname}`;
    const fileRef = bucket.file(filename);

    await fileRef.save(file.buffer, {
      contentType: file.mimetype
    });

    const [metadata] = await fileRef.getMetadata();

    const data = {
      fileName: file.originalname,
      storagePath: filename,
      mimeType: file.mimetype,
      role: "context",
      downloadToken: metadata.metadata.firebaseStorageDownloadTokens,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db
      .collection("sesiones")
      .doc(sessionId)
      .collection("context_files")
      .add(data);

    res.json(data);

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== START =====
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));