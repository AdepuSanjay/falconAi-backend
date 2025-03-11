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

        // Refined Prompt for Proper Slide Formatting
        const prompt = `Create a structured PowerPoint presentation on "${topic}" with exactly ${slideCount} slides. 
        Each slide should be formatted as JSON with:
        - A title in the format "Slide X: Title"
        - A content array with 3-5 bullet points (each as a separate string).
        - If relevant, include short code snippets in a separate "code" field.
        
        Example output format:
        {
            "slides": [
                { "title": "Slide 1: Introduction", "content": ["Point 1", "Point 2", "Point 3"] },
                { "title": "Slide 2: Main Concepts", "content": ["Point A", "Point B", "Point C"], "code": "console.log('Example');" }
            ]
        }
        Return only the JSON object and nothing else.`;

        const response = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        }, {
            headers: { "Content-Type": "application/json" },
            params: { key: GOOGLE_GEMINI_API_KEY }
        });

        let content = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) return res.status(500).json({ error: "No content generated" });

        // Parse JSON response properly
        let slides = [];
        try {
            slides = JSON.parse(content).slides || [];
        } catch (err) {
            console.error("Error parsing JSON from Gemini response:", err);
            return res.status(500).json({ error: "Failed to process slides" });
        }

        // Save slides as JSON
        const filePath = `./generated_ppts/${topic.replace(/\s/g, "_")}.json`;
        fs.writeFileSync(filePath, JSON.stringify(slides, null, 2));

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

        // ✅ Check if file exists
        if (!fs.existsSync(jsonPath)) {
            console.error(`File not found: ${jsonPath}`);
            return res.status(404).json({ error: "No slides found" });
        }

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

        // ✅ Check if file exists
        if (!fs.existsSync(jsonPath)) {
            console.error(`File not found: ${jsonPath}`);
            return res.status(404).json({ error: "No slides found for this topic" });
        }

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

        // ✅ Ensure the file is available before sending
        setTimeout(() => {
            res.download(pdfPath, (err) => {
                if (err) {
                    console.error("Download error:", err);
                    res.status(500).json({ error: "Failed to download PDF" });
                }
            });
        }, 1000); // Small delay to ensure file is written

    } catch (error) {
        console.error("Error generating PDF:", error.message);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
});

if (!fs.existsSync("./resumes")) fs.mkdirSync("./resumes");

// ✅ **Save Original Resume Data**
app.post("/save-resume", (req, res) => {
    try {
        const { name, email, phone, linkedin, summary, skills, experience, education, projects } = req.body;

        if (!name || !email || !skills || !education) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const resumeData = { name, email, phone, linkedin, summary, skills, experience, education, projects };

        const filePath = `./resumes/${name.replace(/\s/g, "_")}_original.json`;
        fs.writeFileSync(filePath, JSON.stringify(resumeData, null, 2), "utf-8");

        res.json({ success: true, message: "Resume data saved successfully" });

    } catch (error) {
        console.error("Error saving resume:", error.message);
        res.status(500).json({ error: "Failed to save resume" });
    }
});

// ✅ **Generate ATS-Friendly Resume using Google Gemini**
app.post("/generate-resume", async (req, res) => {
    try {
        const { name, email, phone, linkedin, summary, skills, experience, education, projects } = req.body;

        if (!name || !email || !skills || !education) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const prompt = `
        Generate a **professional, ATS-friendly resume** for:
        - **Name:** ${name}
        - **Email:** ${email}
        - **Phone:** ${phone || "Not provided"}
        - **LinkedIn:** ${linkedin || "Not provided"}
        - **Summary:** ${summary || "No summary provided"}
        - **Skills:** ${skills.join(", ")}
        - **Experience:** ${experience || "No experience provided"}
        - **Education:** ${education}

        **Projects:**  
        ${projects && projects.length > 0
            ? projects.map((p, i) => `Project ${i + 1}:  
            - **Title:** ${p.title}  
            - **Description:** ${p.description}  
            - **Technologies Used:** ${p.technologies.join(", ")}  
            - **Link:** ${p.link || "Not provided"}\n`).join("\n")
            : "No projects provided"}

        **Resume Format:**
        - **Proper headings (Summary, Skills, Experience, Education, Projects)**
        - **ATS-friendly structure**
        - **Keyword optimization**
        - **Avoid unnecessary formatting**
        `;

        const response = await axios.post(GEMINI_API_URL, {
            contents: [{ parts: [{ text: prompt }] }]
        }, { headers: { "Content-Type": "application/json" }, params: { key: GOOGLE_GEMINI_API_KEY } });

        const resumeText = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Resume generation failed.";

        // Save AI-generated resume
        const filePath = `./resumes/${name.replace(/\s/g, "_")}_ai.json`;
        fs.writeFileSync(filePath, JSON.stringify({ resume: resumeText }, null, 2), "utf-8");

        res.json({ success: true, resume: resumeText });

    } catch (error) {
        console.error("Resume Generation Error:", error.message);
        res.status(500).json({ error: "Failed to generate resume" });
    }
});

// ✅ **Fetch Saved Resume (Original or AI-Generated)**
app.get("/get-resume/:name", (req, res) => {
    try {
        const name = req.params.name.replace(/\s/g, "_");

        const originalPath = `./resumes/${name}_original.json`;
        const aiPath = `./resumes/${name}_ai.json`;

        if (fs.existsSync(originalPath)) {
            return res.json({ type: "original", resume: JSON.parse(fs.readFileSync(originalPath, "utf-8")) });
        } else if (fs.existsSync(aiPath)) {
            return res.json({ type: "ai", resume: JSON.parse(fs.readFileSync(aiPath, "utf-8")).resume });
        } else {
            return res.status(404).json({ error: "No resume found" });
        }

    } catch (error) {
        console.error("Error fetching resume:", error.message);
        res.status(500).json({ error: "Failed to fetch resume" });
    }
});

// ✅ **Download Resume as PDF**
app.post("/download-resume", async (req, res) => {
    try {
        const { name, resume } = req.body;

        if (!name || !resume) return res.status(400).json({ error: "Missing required fields" });

        const pdfPath = `./resumes/${name.replace(/\s/g, "_")}.pdf`;
        const doc = new PDFDocument();

        doc.pipe(fs.createWriteStream(pdfPath));
        doc.fontSize(16).text(resume, { align: "left" });
        doc.end();

        setTimeout(() => {
            res.download(pdfPath, (err) => {
                if (err) {
                    console.error("Download error:", err);
                    res.status(500).json({ error: "Failed to download PDF" });
                }
            });
        }, 1000);

    } catch (error) {
        console.error("PDF Generation Error:", error.message);
        res.status(500).json({ error: "Failed to generate PDF" });
    }
});

// Start Server
app.listen(5000, () => console.log(`✅ Server running on port 5000`));
