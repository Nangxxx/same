import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Route for streaming chat completions server-side
  app.post("/api/chat-stream", async (req, res) => {
    const { messages, systemInstruction } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Missing or invalid messages" });
      return;
    }

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is missing. Please set it in the Secrets panel in AI Studio.");
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // Format messages for @google/genai SDK
      const history = messages.slice(0, -1).map((m: any) => ({
        role: (m.role === "model" ? "model" : "user") as "model" | "user",
        parts: [{ text: m.content || "" }],
      }));

      const lastMessage = messages[messages.length - 1].content || "";

      let activeIterator: any;
      let firstChunkResult: any;
      let modelUsed = "gemini-2.5-flash";

      const createChatStream = async (model: string) => {
        const chat = ai.chats.create({
          model: model,
          config: {
            systemInstruction: systemInstruction,
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          },
          history: history,
        });

        return await chat.sendMessageStream({
          message: lastMessage,
        });
      };

      const modelsToTry = [
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-1.5-flash-8b",
        "gemini-3.5-flash"
      ];

      let lastErrorToThrow: any = null;
      let successfullyInitialized = false;

      for (let i = 0; i < modelsToTry.length; i++) {
        modelUsed = modelsToTry[i];
        try {
          console.info(`Attempting to initialize request with model: ${modelUsed}`);
          const stream = await createChatStream(modelUsed);
          activeIterator = stream[Symbol.asyncIterator]();
          firstChunkResult = await activeIterator.next();
          successfullyInitialized = true;
          console.info(`Successfully initialized stream with model: ${modelUsed}`);
          break;
        } catch (err: any) {
          lastErrorToThrow = err;
          const errStr = err.message || "";
          
          let briefErr = errStr;
          if (briefErr.startsWith("{") || briefErr.includes("quota") || briefErr.includes("limit")) {
            try {
              const parsed = JSON.parse(errStr);
              if (parsed?.error?.message) {
                briefErr = parsed.error.message;
              }
            } catch (_) {
              if (briefErr.length > 200) {
                briefErr = briefErr.substring(0, 200) + "...";
              }
            }
          }
          console.warn(`Model (${modelUsed}) failed initialization: ${briefErr}`);

          const isAuthError = 
            errStr.includes("401") || 
            errStr.includes("403") || 
            errStr.toLowerCase().includes("api key") || 
            errStr.toLowerCase().includes("unauthorized") ||
            errStr.toLowerCase().includes("forbidden") ||
            errStr.includes("API_KEY_INVALID");

          if (isAuthError) {
            console.warn("Fatal authentication or permission error detected. Throwing immediately.");
            throw err;
          }

          if (i === modelsToTry.length - 1) {
            break;
          }
          console.info(`Model ${modelUsed} encountered transient rate-limit/quota/availability error. Falling back to alternative model in sequence...`);
        }
      }

      if (!successfullyInitialized) {
        throw lastErrorToThrow || new Error("Failed to initialize any compatible Gemini model.");
      }

      // Set headers for response streaming/chunking (guaranteed headers are NOT sent yet)
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");

      // Write the first chunk's text if successfully retrieved
      if (firstChunkResult && !firstChunkResult.done && firstChunkResult.value) {
        if (firstChunkResult.value.text) {
          res.write(firstChunkResult.value.text);
        }
      }

      // Keep streaming remaining chunks
      if (firstChunkResult && !firstChunkResult.done) {
        try {
          let nextResult = await activeIterator.next();
          while (!nextResult.done) {
            if (nextResult.value && nextResult.value.text) {
              res.write(nextResult.value.text);
            }
            nextResult = await activeIterator.next();
          }
        } catch (streamingErr: any) {
          console.error("Stream failed mid-stream after headers were sent:", streamingErr);
          res.write(`\n\n[Lỗi kết nối giữa chừng: ${streamingErr.message || "Tín hiệu gián đoạn"}]`);
        }
      }
      res.end();
    } catch (error: any) {
      console.error("Error in server-side chat stream API:", error);

      // Prevent "Cannot set headers after they are sent to the client" if headers were already sent
      if (res.headersSent) {
        console.warn("Headers already sent. Ending response gracefully.");
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      let errorStr = error.message || "Internal server error";
      let is429 = false;
      let is503 = false;

      if (errorStr.includes("429") || errorStr.toLowerCase().includes("quota") || errorStr.includes("RESOURCE_EXHAUSTED")) {
        is429 = true;
      }
      if (errorStr.includes("503") || errorStr.toLowerCase().includes("unavailable") || errorStr.toLowerCase().includes("demand") || errorStr.includes("UNAVAILABLE")) {
        is503 = true;
      }

      try {
        // Check if error.message is double-serialized JSON
        const parsed = JSON.parse(errorStr);
        if (parsed.error && parsed.error.message) {
          const innerMsg = parsed.error.message;
          errorStr = innerMsg;
          if (parsed.error.code === 429 || innerMsg.includes("429") || innerMsg.includes("quota") || innerMsg.includes("RESOURCE_EXHAUSTED")) {
            is429 = true;
          }
          if (parsed.error.code === 503 || innerMsg.includes("503") || innerMsg.toLowerCase().includes("unavailable") || innerMsg.toLowerCase().includes("demand") || innerMsg.includes("UNAVAILABLE")) {
            is503 = true;
          }
        }
      } catch (e) {
        // If not a JSON string, try to parse error itself if it has a json-like message properties
        if (typeof errorStr === "string" && errorStr.startsWith("{") && errorStr.endsWith("}")) {
          try {
            const parsed = JSON.parse(errorStr);
            if (parsed.error && parsed.error.message) {
              errorStr = parsed.error.message;
              if (parsed.error.code === 429) is429 = true;
              if (parsed.error.code === 503) is503 = true;
            }
          } catch (_) {}
        }
      }

      if (is429) {
        res.status(429).json({
          error: "QUOTA_EXHAUSTED",
          message: errorStr
        });
      } else if (is503) {
        res.status(503).json({
          error: "TEMPORARILY_UNAVAILABLE",
          message: errorStr
        });
      } else {
        res.status(500).json({ error: errorStr });
      }
    }
  });

  // Vite development middleware or production static deployment
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
