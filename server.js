const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const multer = require("multer");
const pptxgen = require("pptxgenjs");
const PDFDocument = require("pdfkit");
require("dotenv").config();

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
const upload = multer({ dest: "uploads/" });



app.post("/update-slides", (req, res) => {
    try {
        const { topic, slides } = req.body;
        const jsonPath = `./generated_ppts/${topic.replace(/\s/g, "_")}.json`;

        // Save updated slides to JSON file
        fs.writeFileSync(jsonPath, JSON.stringify(slides, null, 2), "utf-8");

        res.json({ success: true, message: "Slides updated successfully" });
    } catch (error) {
        console.error("Error updating slides:", error.message);
        res.status(500).json({ error: "Failed to update slides" });
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


// ✅ Convert Speech to Text using Google Gemini
app.post("/speech-to-text", upload.single("audio"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

        const audioBuffer = fs.readFileSync(req.file.path);
        const base64Audio = audioBuffer.toString("base64");

        const transcript = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: "Convert this speech to text:", inline_data: { mime_type: "audio/wav", data: base64Audio } }] }]
        }, { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY } });

        const text = transcript.data.candidates?.[0]?.content?.parts?.[0]?.text || "No text extracted.";
        res.json({ text });

    } catch (error) {
        console.error("Speech-to-text error:", error.message);
        res.status(500).json({ error: "Failed to process speech" });
    }
});


// ✅ Check Slides Before Downloading
app.get("/check-slides", (req, res) => {
    const topic = req.query.topic;
    const filePath = `./generated_ppts/${topic.replace(/\s/g, "_")}.json`;

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "No slides found for this topic" });

    const slides = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json({ topic, slides });
});


// ✅ Generate Slides using Google Gemini
app.post("/generate-ppt", async (req, res) => {
    try {
        const { topic, slideCount } = req.body;
        if (!topic) return res.status(400).json({ error: "Topic is required" });
        if (!slideCount || slideCount < 1 || slideCount > 13)
            return res.status(400).json({ error: "Slide count must be between 1 and 13" });

        const prompt = `Create a PowerPoint presentation on "${topic}" with exactly ${slideCount} slides.
        - Each slide should have:
          - A **title** in the format "**Slide X: [Title]**"
          - 3-5 key bullet points per slide.
          - Code snippets for programming topics.
        Format strictly as:
        **Slide 1: [Title]**
        - Point 1
        - Point 2`;

        const response = await axios.post(GEMINI_API_URL, { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY } });

        const content = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) return res.status(500).json({ error: "No content generated" });

        let slides = [];
        let currentSlide = null;

        content.split("\n").forEach(line => {
            line = line.trim();
            if (line.startsWith("**Slide")) {
                if (currentSlide) slides.push(currentSlide);
                currentSlide = { title: line.replace(/\*\*Slide \d+:?\*\*/g, "").trim(), content: [] };
            } else if (currentSlide && line !== "") {
                currentSlide.content.push(line);
            }
        });

        if (currentSlide) slides.push(currentSlide);

        fs.writeFileSync(`./generated_ppts/${topic.replace(/\s/g, "_")}.json`, JSON.stringify(slides, null, 2));
        res.json({ message: "Slides generated successfully", slides });

    } catch (error) {
        console.error("Error generating slides:", error.message);
        res.status(500).json({ error: "Failed to generate slides" });
    }
});


// ✅ Download PPTX
app.get("/download-ppt/:topic", async (req, res) => {
    try {
        const topic = req.params.topic;
        const jsonPath = `./generated_ppts/${topic.replace(/\s/g, "_")}.json`;

        if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "No slides found" });

        const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        let pptx = new pptxgen();

        slides.forEach((slide, index) => {
            let pptSlide = pptx.addSlide();
            pptSlide.addText(`Slide ${index + 1}: ${slide.title}`, { x: 1, y: 0.5, fontSize: 24, bold: true });
            slide.content.forEach((point, i) => {
                pptSlide.addText(`- ${point}`, { x: 1, y: 1 + i * 0.5, fontSize: 18 });
            });
        });

        const pptBuffer = await pptx.write("arraybuffer");

        res.set({
            "Content-Disposition": `attachment; filename="${topic.replace(/\s/g, "_")}.pptx"`,
            "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });

        res.send(Buffer.from(pptBuffer));

    } catch (error) {
        console.error("Error generating PPT:", error.message);
        res.status(500).json({ error: "Failed to generate PPT" });
    }
});


// ✅ Download PDF
app.get("/download-pdf/:topic", (req, res) => {
    try {
        const topic = req.params.topic;
        const jsonPath = `./generated_ppts/${topic.replace(/\s/g, "_")}.json`;
        const pdfPath = `./generated_ppts/${topic.replace(/\s/g, "_")}.pdf`;

        if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: "No slides found for this topic" });

        const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        const doc = new PDFDocument({ autoFirstPage: false });

        doc.pipe(fs.createWriteStream(pdfPath));

        slides.forEach((slide, index) => {
            doc.addPage();
            doc.fontSize(24).text(slide.title, { underline: true, align: "center" });

            doc.moveDown();
            slide.content.forEach(text => {
                doc.fontSize(14).text(text, { align: "left" });
                doc.moveDown();
            });
        });

        doc.end();
        res.download(pdfPath);

    } catch (error) {
        console.error("Error generating PDF:", error.message);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
}); 

// Start Server
app.listen(5000, () => console.log(`✅ Server running on port 5000`));
