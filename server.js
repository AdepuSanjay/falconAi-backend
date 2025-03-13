const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path=require("path");
const multer = require("multer");
const pptxgen = require("pptxgenjs");
const PDFDocument = require("pdfkit");
require("dotenv").config();

const mammoth = require("mammoth");
const pptx2json = require("pptx2json");

 
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


async function extractImagesFromPDF(pdfPath) {
    const existingPdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const images = [];

    for (const page of pdfDoc.getPages()) {
        const imageObjects = page.node.Resources.XObject;
        if (imageObjects) {
            for (const key in imageObjects) {
                const obj = imageObjects[key];
                if (obj instanceof PDFDocument.Image) {
                    images.push(obj);
                }
            }
        }
    }
    return images;
}

async function extractImagesFromDocx(docxPath) {
    const docBuffer = fs.readFileSync(docxPath);
    const result = await mammoth.extractRawText({ buffer: docBuffer });
    return result.images; // Extract images from DOCX
}

async function extractImagesFromPPTX(pptxPath) {
    const slides = await pptx2json(pptxPath);
    let images = [];
    slides.forEach(slide => {
        if (slide.images) images.push(...slide.images);
    });
    return images;
}

async function createPDFWithImages(imagePaths) {
    const pdfDoc = await PDFDocument.create();

    for (const imgPath of imagePaths) {
        const imageBytes = fs.readFileSync(imgPath);
        const img = await pdfDoc.embedJpg(imageBytes);
        const page = pdfDoc.addPage([600, 800]); // Adjust page size if needed
        page.drawImage(img, { x: 50, y: 50, width: 500, height: 700 });
    }

    return pdfDoc.save();
}

app.post("/extract-images", upload.single("file"), async (req, res) => {
    const { path: filePath, originalname } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    let images = [];

    try {
        if (ext === ".pdf") images = await extractImagesFromPDF(filePath);
        else if (ext === ".docx") images = await extractImagesFromDocx(filePath);
        else if (ext === ".pptx") images = await extractImagesFromPPTX(filePath);
        else return res.status(400).json({ error: "Unsupported file type." });

        if (!images.length) return res.status(400).json({ error: "No images found." });

        const pdfBuffer = await createPDFWithImages(images);
        const pdfPath = "output/extracted_images.pdf";
        fs.writeFileSync(pdfPath, pdfBuffer);
        res.download(pdfPath);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to process file." });
    }
});












// Supported languages (you can add more)
const supportedLanguages = ["English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam"];

// Pre-defined letter templates
const letterTemplates = {
  leave_application: `Subject: Request for Leave\n\nDear [Recipient's Name],\n\nI am writing to request leave from [start date] to [end date] due to [reason]. Kindly grant me permission for the mentioned period.\n\nSincerely,\n[Your Name]`,
  
  bonafide_certificate: `Subject: Request for Bonafide Certificate\n\nDear [Recipient's Name],\n\nI am a student of [college/school name], and I require a bonafide certificate for [reason]. Please process my request at the earliest.\n\nThank you.\n\nSincerely,\n[Your Name]`,
  
  event_permission: `Subject: Permission Request for Event Participation\n\nDear [Recipient's Name],\n\nI seek permission to participate in [event name] on [event date]. Kindly grant me the necessary approval.\n\nSincerely,\n[Your Name]`,
};

// Generate a letter in multiple languages
app.post("/generate-letter", async (req, res) => {
  try {
    const { letterType, recipientName, userName, reason, startDate, endDate, targetLanguage } = req.body;

    if (!letterTemplates[letterType]) {
      return res.status(400).json({ error: "Invalid letter type" });
    }

    if (targetLanguage && !supportedLanguages.includes(targetLanguage)) {
      return res.status(400).json({ error: "Unsupported language" });
    }

    // Generate a personalized letter
    let letterContent = letterTemplates[letterType]
      .replace("[Recipient's Name]", recipientName)
      .replace("[Your Name]", userName)
      .replace("[reason]", reason || "")
      .replace("[start date]", startDate || "")
      .replace("[end date]", endDate || "");

    // Translate the letter if the user selects a different language
    if (targetLanguage && targetLanguage !== "English") {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
        {
          contents: [{ parts: [{ text: `Translate this text to ${targetLanguage}: ${letterContent}` }] }]
        },
        { headers: { "Content-Type": "application/json" } }
      );

      letterContent = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || letterContent;
    }

    res.json({ success: true, letterContent });
  } catch (error) {
    console.error("Letter Generation Error:", error.message);
    res.status(500).json({ error: "Failed to generate letter" });
  }
});

// Fetch available templates
app.get("/letter-templates", (req, res) => {
  res.json({ success: true, templates: Object.keys(letterTemplates), supportedLanguages });
});

// 🆕 Translation Endpoint
app.post("/translate", async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguage } = req.body;
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: "Text and targetLanguage are required" });
    }

    // Constructing the prompt dynamically
    let prompt = `Translate the following text to ${targetLanguage}: ${text}`;
    if (sourceLanguage) {
      prompt = `Translate the following text from ${sourceLanguage} to ${targetLanguage}: ${text}`;
    }

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
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

// Function to parse Gemini AI response into structured slides
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

            // Escape backticks in code blocks to prevent syntax errors
            const formattedContent = contentLines.map(line => 
                line.includes("```") ? line.replace(/```/g, "\\`\\`\\`") : line
            );

            slides.push({ title, content: formattedContent });
        }
    });

    return slides.length ? { slides } : { error: "Invalid AI response format" };
}

// API Route to Generate PPT from Gemini AI
app.post("/generate-ppt", async (req, res) => {
    const { topic, slidesCount } = req.body;

    if (!topic || !slidesCount) {
        return res.status(400).json({ error: "Missing required fields: topic and slidesCount" });
    }

    // Detect if the topic is related to coding
    const isCodingTopic = ["Java", "Python", "JavaScript", "C++", "C#", "React", "Node.js"].some(lang => 
        topic.toLowerCase().includes(lang.toLowerCase())
    );

    let prompt;
    if (isCodingTopic) {
        prompt = `
Generate a PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.
Each slide should:
1. Have a title in "**Slide X: Title**" format.
2. Contain bullet points explaining key concepts.
3. Include **properly formatted code snippets** using "\`\`\`${topic.toLowerCase()}" syntax.
4. Ensure structured explanations.

Example:

**Slide 1: Introduction to ${topic}**
- ${topic} is a powerful programming language.
- Used in web development, software engineering, and more.

**Slide 2: Hello World Program**
\`\`\`${topic.toLowerCase()}
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
\`\`\`

**Slide 3: Variables and Data Types**
- Statically typed language.
- Example:
\`\`\`${topic.toLowerCase()}
int age = 25;
double price = 19.99;
boolean isAvailable = true;
\`\`\`

Ensure the response follows this exact format.
        `;
    } else {
        prompt = `
Generate a structured PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.
Each slide should:
1. Have a title in "**Slide X: Title**" format.
2. Include bullet points explaining key concepts.
3. Provide clear, structured information.

Example:

**Slide 1: Introduction to ${topic}**
- Definition of ${topic}.
- Importance and applications.

**Slide 2: Key Features**
- Feature 1
- Feature 2

Ensure the response follows this exact slide format.
        `;
    }

    try {
        const geminiResponse = await axios.post(`${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`, {
            contents: [{ parts: [{ text: prompt }] }]
        });

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


// ✅ Download PPTX
app.get("/download-pptx/:topic", async (req, res) => {
  try {
    const topic = req.params.topic;
    const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: "No slides found" });
    }

    const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    let pptx = new pptxgen();

    slides.forEach((slide) => {
      let pptSlide = pptx.addSlide();
      pptSlide.addText(slide.title, { x: 1, y: 0.5, fontSize: 24, bold: true });

      slide.content.forEach((point, i) => {
        pptSlide.addText(`- ${point}`, { x: 1, y: 1 + i * 0.5, fontSize: 18 });
      });
    });

    const pptBuffer = await pptx.writeBuffer();
    res.set({
      "Content-Disposition": `attachment; filename="${topic.replace(/\s/g, "_")}.pptx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    res.send(pptBuffer);
  } catch (error) {
    console.error("Error generating PPT:", error);
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
