const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const PptxGenJS = require("pptxgenjs");
const { exec } = require("child_process");
require("dotenv").config();
const sizeOf = require("image-size");

const app = express();
app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));
app.use(express.json());

const TEMP_DIR = "/tmp/generated_ppts";
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
    console.error("❌ Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

app.get("/get-slides/:topic", (req, res) => {
    try {
        const topic = req.params.topic;
        const jsonPath = path.join(TEMP_DIR, `${topic.replace(/\s/g, "_")}.json`);

        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: "No slides found for this topic" });
        }

        const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        res.json({ success: true, slides });
    } catch (error) {
        console.error("Error fetching slides:", error.message);
        res.status(500).json({ error: "Failed to fetch slides" });
    }
});

app.post("/update-slides", (req, res) => {
    try {
        const { topic, slides, useImages } = req.body;
        const jsonPath = path.join(TEMP_DIR, `${topic.replace(/\s/g, "_")}.json`);

        if (!slides || slides.length === 0) {
            return res.status(400).json({ error: "No slides to save" });
        }

        const formattedSlides = slides.map((slide) => ({
            title: slide.title || "Untitled Slide",
            content: (slide.content || []).filter(text => text.trim() !== ""),
            theme: slide.theme || "#FFFFFF",
            titleColor: slide.titleColor || "#000000",
            contentColor: slide.contentColor || "#000000",
            image: useImages ? slide.image || null : null,
        }));

        fs.writeFileSync(jsonPath, JSON.stringify(formattedSlides, null, 2), "utf-8");
        res.json({ success: true, message: "Slides updated successfully!" });
    } catch (error) {
        console.error("Error updating slides:", error.message);
        res.status(500).json({ error: "Failed to update slides" });
    }
});

function parseGeminiResponse(responseText) {
    const slides = [];
    const slideSections = responseText.split("Slide ");

    slideSections.forEach((section) => {
        const match = section.match(/^(\d+):\s*(.+)/);
        if (match) {
            const title = match[2].trim();
            const contentLines = section.split("\n").slice(1).map(line => line.trim()).filter(line => line);
            const formattedContent = contentLines.map(line => 
                line.includes("```") ? line.replace(/```/g, "\\`\\`\\`") : line
            );

            slides.push({ title, content: formattedContent });
        }
    });

    return slides.length ? { slides } : { error: "Invalid AI response format" };
}

app.post("/generate-ppt", async (req, res) => {
    const { topic, slidesCount } = req.body;

    if (!topic || !slidesCount) {
        return res.status(400).json({ error: "Missing required fields: topic and slidesCount" });
    }

    const isCodingTopic = ["Java", "Python", "JavaScript", "C++", "C#", "React", "Node.js"].some(lang => 
        topic.toLowerCase().includes(lang.toLowerCase())
    );

    let prompt;
    if (isCodingTopic) {
        prompt = `
Generate a PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.

Slide Structure:

1. Slide Title: Format as "Slide X: Title".
2. Explanation: Provide clear, structured bullet points.
3. Code Snippets: Format code properly using "${topic.toLowerCase()}" syntax.

Example:

Slide 1: Introduction to ${topic}

- ${topic} is a widely used programming language.
- It is used in web development, automation, and AI.

Slide 2: Hello World Example

- A simple program to print "Hello, World!" in ${topic}.

\`\`\`${topic.toLowerCase()}
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
\`\`\`
`;
    } else {
        prompt = `
Generate a structured PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.

Slide Structure:

1. Slide Title: Format as "Slide X: Title".
2. Content: Bullet points explaining key concepts in simple terms.

Example:

Slide 1: Introduction to ${topic}

- Definition of ${topic}.
- Importance and real-world applications.

Slide 2: Key Features

- Feature 1: Explanation.
- Feature 2: Explanation.
`;
    }

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

        return res.json(formattedSlides);
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return res.status(500).json({ error: "Failed to generate slides from AI." });
    }
});

app.get("/check-slides", (req, res) => {
    const topic = req.query.topic;
    const filePath = path.join(TEMP_DIR, `${topic.replace(/\s/g, "_")}.json`);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "No slides found for this topic" });

    const slides = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json({ topic, slides });
});

// ✅ Generate and download PPT (fixed storage location)
app.get("/download-ppt/:topic", async (req, res) => {
    try {
        const topic = req.params.topic;
        const jsonPath = path.join(TEMP_DIR, ${topic.replace(/\s/g, "_")}.json);

        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: "No slides found for this topic" });
        }

        const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        let pptx = new PptxGenJS();

        for (const slide of slides) {
            let slidePpt = pptx.addSlide();
            slidePpt.background = { color: slide.theme || "#dde6edcd" };

            slidePpt.addText(slide.title, {
                x: 0.5, y: 0.5, w: "90%",
                fontSize: 28, bold: true,
                color: slide.titleColor || "#D63384",
                align: "left", fontFace: "Arial Black"
            });

            let formattedContent = slide.content.map(point => 🔹 ${point}).join("\n");

            if (slide.image) {
                const imagePath = await downloadImageIfNeeded(slide.image);
                slidePpt.addText(formattedContent, { x: 0.5, y: 1.5, w: "70%", h: 3.5, fontSize: 20, color: "#333", fontFamily: "Playfair Display" });
                slidePpt.addImage({ path: imagePath, x: 8, y: 1.5, w: 2, h: 2 });
            } else {
                slidePpt.addText(formattedContent, { x: 0.5, y: 1.5, w: "90%", fontSize: 20, color: "#333", fontFamily: "Playfair Display" });
            }
        }

        // ✅ Save PPT in /tmp/
        const pptPath = path.join("/tmp", ${topic.replace(/\s/g, "_")}.pptx);
        await pptx.writeFile({ fileName: pptPath });

        res.download(pptPath, ${topic}.pptx, (err) => {
            if (err) console.error("Download error:", err);
        });
    } catch (error) {
        console.error("Error generating PPT:", error.message);
        res.status(500).json({ error: "Failed to generate PowerPoint file." });
    }
});

// ✅ AI-Powered Search using Google Gemini
app.post("/ai-search", async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: "Query is required" });

        const response = await axios.post(
            GEMINI_API_URL,
            { contents: [{ parts: [{ text: query }] }] },
            { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY } }
        );

        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No relevant information found.";
        res.json({ query, response: aiResponse });

    } catch (error) {
        console.error("AI Search Error:", error.message);
        res.status(500).json({ error: "Failed to fetch search results" });
    }
});





app.listen(3000, () => {
    console.log("Server running on port 3000");
});