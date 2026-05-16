import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini with the platform-injected API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY is not set in environment variables.");
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

app.post("/api/forge", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Gemini API key is missing. Please configure it in the project settings." });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: `You are a Minecraft Bedrock voxel furniture designer.
Output ONLY a raw JSON array of objects.
Each object MUST have these properties: x, y, z, block.
Constraints: 
- x (0-15), y (0-15), z (0-15).
- block: one of [oak_planks, oak_log, spruce_planks, stone, cobblestone, white_wool, red_wool, blue_wool, gold_block, glass].
- No markdown, no explanation, no surrounding text. Just the [ ... ] array.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.INTEGER },
              y: { type: Type.INTEGER },
              z: { type: Type.INTEGER },
              block: { type: Type.STRING }
            },
            required: ["x", "y", "z", "block"]
          }
        },
        temperature: 1.0,
      }
    });

    const text = response.text.trim();
    console.log("AI Response:", text);

    let voxels;
    try {
      voxels = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("The forge produced an unreadable design blueprint.");
      voxels = JSON.parse(jsonMatch[0]);
    }
    
    if (!Array.isArray(voxels)) {
      if ((voxels as any).voxels && Array.isArray((voxels as any).voxels)) {
        voxels = (voxels as any).voxels;
      } else {
        throw new Error("AI response is not an array");
      }
    }
    
    res.json({ voxels });
  } catch (error: any) {
    console.error("AI Forge Error:", error);
    const message = error.message || "The forge failed to ignite.";
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
