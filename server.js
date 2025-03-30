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
const Tesseract = require("tesseract.js");
const sizeOf = require("image-size");
const mammoth = require("mammoth");
const PPTX2Json = require("pptx2json");

const app = express();
app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));
app.use(express.json());

// Ensure 'generated_ppts' folder exists
if (!fs.existsSync("./generated_ppts")) fs.mkdirSync("./generated_ppts");

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
    console.error("❌ Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

app.get("/get-slides/:topic", (req, res) => {
    try {
        const topic = req.params.topic;
        const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);
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

app.post("/translate", async (req, res) => {
    try {
        const { text, sourceLanguage, targetLanguage } = req.body;
        if (!text || !targetLanguage) {
            return res.status(400).json({ error: "Text and targetLanguage are required" });
        }

        let prompt = `Translate the following text to ${targetLanguage}: ${text}`;
        if (sourceLanguage) {
            prompt = `Translate the following text from ${sourceLanguage} to ${targetLanguage}: ${text}`;
        }

        const response = await axios.post(
            `${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { "Content-Type": "application/json" } }
        );

        const translatedText = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Translation failed";
        res.json({ success: true, translatedText });
    } catch (error) {
        console.error("Translation Error:", error.message);
        res.status(500).json({ error: "Translation failed" });
    }
});

app.post("/update-slides", (req, res) => {
    try {
        const { topic, slides, useImages } = req.body;
        const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);

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

app.get("/check-slides", (req, res) => {
    const topic = req.query.topic;
    const filePath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "No slides found for this topic" });

    const slides = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json({ topic, slides });
});

function parseGeminiResponse(responseText) {
    const slides = [];
    const slideSections = responseText.split("Slide ");

    slideSections.forEach((section) => {
        const match = section.match(/^(\d+):\s*(.+)/);
        if (match) {
            const title = match[2].trim();
            const contentLines = section
                .split("\n")
                .slice(1)
                .map(line => line.trim())
                .filter(line => line);

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

    let prompt = `Generate a structured PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.`;

    try {
        const geminiResponse = await axios.post(
            `${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { "Content-Type": "application/json" } }
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


app.get("/download-ppt/:topic", async (req, res) => {
const topic = req.params.topic;
const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);
if (!fs.existsSync(jsonPath)) {
return res.status(404).json({ error: "No slides found for this topic" });
}

const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
let pptx = new PptxGenJS();

slides.forEach((slide) => {
let slidePpt = pptx.addSlide();
slidePpt.background = { color: slide.theme || "#dde6edcd" };

const titleX = 0.5, titleY = 0.5, titleW = "90%";  // Shifted title slightly down        

slidePpt.addText(slide.title, {        
    x: titleX, y: titleY, w: titleW,        
    fontSize: 28, bold: true,        
    color: slide.titleColor || "#D63384",        
    align: "left", fontFace: "Arial Black"        
});        

let contentFont = "Arial"; // Professional font for better readability        
let formattedContent = slide.content.map(point => `🔹 ${point}`).join("\n"); // Prefix each point        

if (slide.image) {        
    // If image exists, content stays on the left, and image moves 5px left        
    slidePpt.addText(formattedContent, {        
        x: 0.5, y: 1.5, w: "70%", h: 3.5,        
        fontSize: 20, color: slide.contentColor || "#333333",        
        fontFace: contentFont, lineSpacing: 28, align: "left"        
    });        

    slidePpt.addImage({        
        path: slide.image,        
        x: 7.36, y: 1.5, w: 2.5, h: 2.5  // Image moved 5px left        
    });        
} else {        
    // If no image, expand content to full width        
    slidePpt.addText(formattedContent, {        
        x: 0.5, y: 1.5, w: "95%", h: 3.5,        
        fontSize: 20, color: slide.contentColor || "#333333",        
        fontFace: contentFont, lineSpacing: 28, align: "left"        
    });        
}

});




const PORT = process.env.PORT || 3000;
