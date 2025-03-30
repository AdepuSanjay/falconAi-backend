const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));
app.use(express.json());

// ✅ Use /tmp for temporary file storage
const TEMP_DIR = "/tmp";  
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

// Ensure /tmp exists (Not required in Vercel, but added for safety)
(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (err) {
        console.error("Failed to create temporary directory:", err.message);
    }
})();

app.get("/get-slides/:topic", async (req, res) => {
    try {
        const topic = req.params.topic.replace(/\s/g, "_");
        const jsonPath = path.join(TEMP_DIR, `${topic}.json`);

        if (!(await fileExists(jsonPath))) {
            return res.status(404).json({ error: "No slides found for this topic" });
        }

        const slides = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
        res.json({ success: true, slides });
    } catch (error) {
        console.error("Error fetching slides:", error.message);
        res.status(500).json({ error: "Failed to fetch slides" });
    }
});

app.post("/generate-ppt", async (req, res) => {
    const { topic, slidesCount } = req.body;

    if (!topic || !slidesCount) {
        return res.status(400).json({ error: "Missing required fields: topic and slidesCount" });
    }

    const prompt = `Generate a structured PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.`;

    try {
        const geminiResponse = await axios.post(
            `${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );

        const aiText = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const formattedSlides = parseGeminiResponse(aiText);

        if (formattedSlides.error) {
            return res.status(500).json({ error: "Unexpected AI response. Please try again." });
        }

        // ✅ Save slides to /tmp directory
        const jsonPath = path.join(TEMP_DIR, `${topic.replace(/\s/g, "_")}.json`);
        await fs.writeFile(jsonPath, JSON.stringify(formattedSlides.slides, null, 2), "utf-8");

        return res.json({ success: true, slides: formattedSlides.slides });
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return res.status(500).json({ error: "Failed to generate slides from AI." });
    }
});

app.get("/download-ppt/:topic", async (req, res) => {
    try {
        const topic = req.params.topic.replace(/\s/g, "_");
        const jsonPath = path.join(TEMP_DIR, `${topic}.json`);

        if (!(await fileExists(jsonPath))) {
            return res.status(404).json({ error: "No slides found for this topic" });
        }

        const slides = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
        const pptx = new PptxGenJS();

        for (const slide of slides) {
            let slidePpt = pptx.addSlide();
            slidePpt.background = { color: slide.theme || "#dde6edcd" };

            slidePpt.addText(slide.title, {
                x: 0.5, y: 0.5, w: "90%", fontSize: 28, bold: true,
                color: slide.titleColor || "#D63384", align: "left"
            });

            let formattedContent = slide.content.map(point => `🔹 ${point}`).join("\n");
            slidePpt.addText(formattedContent, { x: 0.5, y: 1.5, w: "90%", fontSize: 20, color: "#333" });
        }

        // ✅ Save PPT to /tmp directory
        const pptPath = path.join(TEMP_DIR, `${topic}.pptx`);
        await pptx.writeFile({ fileName: pptPath });

        res.download(pptPath, `${topic}.pptx`, (err) => {
            if (err) console.error("Download error:", err);
        });
    } catch (error) {
        console.error("Error generating PPT:", error.message);
        res.status(500).json({ error: "Failed to generate PowerPoint file." });
    }
});

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function parseGeminiResponse(responseText) {
    const slides = [];
    const slideSections = responseText.split("Slide ");

    slideSections.forEach((section) => {
        const match = section.match(/^(\d+):\s*(.+)/);
        if (match) {
            const title = match[2].trim();
            const contentLines = section.split("\n").slice(1).map(line => line.trim()).filter(line => line);
            slides.push({ title, content: contentLines });
        }
    });

    return slides.length ? { slides } : { error: "Invalid AI response format" };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});