const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const multer = require("multer");
const pptxgen = require("pptxgenjs");
const PDFDocument = require("pdfkit");
require("dotenv").config();

const app = express();
app.use(cors({
  origin: "http://localhost:5173"
}));
app.use(express.json());

// Ensure 'generated_ppts' folder exists
if (!fs.existsSync("./generated_ppts")) fs.mkdirSync("./generated_ppts");

// Load API key
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
    console.error("Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";
const slideData = {}; // Store slides in memory

const upload = multer({ dest: "uploads/" });

// ✅ Convert speech to text using Google Gemini
app.post("/speech-to-text", upload.single("audio"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

        const audioBuffer = fs.readFileSync(req.file.path);
        const base64Audio = audioBuffer.toString("base64");

        const transcript = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: "Convert this speech to text: ", inline_data: { mime_type: "audio/wav", data: base64Audio } }] }]
        }, { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY } });

        const text = transcript.data.candidates?.[0]?.content?.parts?.[0]?.text || "No text extracted.";
        res.json({ text });

    } catch (error) {
        console.error("Speech-to-text error:", error.message);
        res.status(500).json({ error: "Failed to process speech" });
    }
});

// ✅ Check slides before downloading
app.get("/check-slides", (req, res) => {
    const topic = req.query.topic;
    if (!topic || !slideData[topic]) return res.status(404).json({ error: "No slides found for this topic" });
    res.json({ topic, slides: slideData[topic] });
});

// ✅ Generate slides using Google Gemini
app.post("/generate-ppt", async (req, res) => {
    try {
        const { topic, slideCount } = req.body;
        if (!topic) return res.status(400).json({ error: "Topic is required" });
        if (!slideCount || slideCount < 1 || slideCount > 13) return res.status(400).json({ error: "Slide count must be between 1 and 13" });

        const slideStructure = [
            { title: "Title Slide", content: ["Title: Clear & Engaging", "Subtitle: Brief overview"] },
            { title: "Introduction", content: ["Definition & Importance", "Key Statistics"] },
            { title: "Key Concepts", content: ["Explain key points", "Provide real-world examples"] },
            { title: "Applications", content: ["Industry Use Cases", "Practical Examples"] },
            { title: "Challenges & Future Trends", content: ["Limitations", "Future Scope"] }
        ];

        const selectedSlides = slideStructure.slice(0, slideCount);
        const slideRequestText = selectedSlides.map((s, i) => `**Slide ${i + 1}: ${s.title}**\n${s.content.map(c => `- ${c}`).join("\n")}`).join("\n\n");

        const prompt = `Create a PowerPoint presentation on "${topic}" with ${slideCount} slides.
        - Each slide must have detailed bullet points.
        - If the topic is related to programming, include code snippets.
        - Format slides with bold headers and bullet points.\n\n${slideRequestText}`;

        const response = await axios.post(GEMINI_API_URL, { contents: [{ parts: [{ text: prompt }] }] }, { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY }, timeout: 90000 });

        const content = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) return res.status(500).json({ error: "No content generated" });

        slideData[topic] = content.split("\n").filter(line => line.trim() !== "");
        res.json({ message: "Slides generated successfully", slides: slideData[topic] });

    } catch (error) {
        console.error("Error generating slides:", error.message);
        res.status(500).json({ error: "Failed to generate slides" });
    }
});

// ✅ Add, Edit, and Delete Slides
app.post("/edit-ppt", (req, res) => {
    try {
        const { topic, action, newSlide, position } = req.body;
        if (!topic) return res.status(400).json({ error: "Topic is required" });

        slideData[topic] = slideData[topic] || [];

        switch (action) {
            case "add":
                if (!newSlide) return res.status(400).json({ error: "New slide content required" });
                if (position === "top") slideData[topic].unshift(newSlide);
                else if (position === "bottom") slideData[topic].push(newSlide);
                else if (!isNaN(position) && position >= 0 && position <= slideData[topic].length) slideData[topic].splice(position, 0, newSlide);
                else return res.status(400).json({ error: "Invalid position" });
                break;

            case "edit":
                if (position < 0 || position >= slideData[topic].length) return res.status(400).json({ error: "Invalid slide position" });
                slideData[topic][position] = newSlide;
                break;

            case "delete":
                if (position < 0 || position >= slideData[topic].length) return res.status(400).json({ error: "Invalid slide position" });
                slideData[topic].splice(position, 1);
                break;

            default:
                return res.status(400).json({ error: "Invalid action" });
        }

        res.json({ message: "Slides updated successfully", slides: slideData[topic] });

    } catch (error) {
        res.status(500).json({ error: "Failed to update slides" });
    }
});

// ✅ Download slides as PPTX
app.get("/download-ppt/:topic", async (req, res) => {
    try {
        const topic = req.params.topic;
        if (!slideData[topic]) return res.status(404).json({ error: "No slides found" });

        let pptx = new pptxgen();
        slideData[topic].forEach((text, index) => {
            let slide = pptx.addSlide();
            slide.addText(`Slide ${index + 1}`, { x: 1, y: 1, fontSize: 24, bold: true });
            slide.addText(text, { x: 1, y: 2, fontSize: 18 });
        });

        const filePath = `./generated_ppts/${topic.replace(/\s/g, "_")}.pptx`;
        await pptx.writeFile(filePath);

        res.download(filePath);

    } catch (error) {
        res.status(500).json({ error: "Failed to generate PPT" });
    }
});

// ✅ Download slides as PDF
app.get("/download-pdf/:topic", (req, res) => {
    try {
        const topic = req.params.topic;
        if (!slideData[topic]) return res.status(404).json({ error: "No slides found" });

        const doc = new PDFDocument();
        const filePath = `./generated_ppts/${topic.replace(/\s/g, "_")}.pdf`;

        doc.pipe(fs.createWriteStream(filePath));
        doc.fontSize(24).text(topic, { underline: true });

        slideData[topic].forEach((text, index) => {
            doc.fontSize(18).text(`Slide ${index + 1}:`, { underline: true });
            doc.fontSize(14).text(text);
            doc.moveDown();
        });

        doc.end();
        res.download(filePath);

    } catch (error) {
        res.status(500).json({ error: "Failed to generate PDF" });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
