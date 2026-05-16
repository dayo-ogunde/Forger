import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// AI Generation Endpoint
app.post("/api/forge", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: `You are BitForge AI, a Minecraft Bedrock furniture architect. 
        Your task is to generate a 3D voxel model based on a user's prompt.
        The grid is 16x16x16 (x, y, z from 0 to 15).
        Output a JSON object containing an array of 'voxels'.
        Each voxel must have:
        - x (0-15)
        - y (0-15)
        - z (0-15)
        - block: a hex color string (e.g., "#9d814d") OR a preset ID from this list: oak_planks, oak_log, spruce_planks, stone, cobblestone, white_wool, red_wool, blue_wool, gold_block, glass.

        Focus on structural integrity and aesthetics. 
        For furniture, 'y=0' is the floor. 
        Keep models within 16x16x16 dimensions.
        Do not explain anything, just output the JSON.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            voxels: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.INTEGER },
                  y: { type: Type.INTEGER },
                  z: { type: Type.INTEGER },
                  block: { type: Type.STRING },
                  isCustom: { type: Type.BOOLEAN }
                },
                required: ["x", "y", "z", "block"]
              }
            }
          },
          required: ["voxels"]
        }
      },
    });

    const result = JSON.parse(response.text || "{}");
    res.json(result);
  } catch (error: any) {
    console.error("AI Generation Error:", error);
    res.status(500).json({ error: error.message || "Failed to forge design" });
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
