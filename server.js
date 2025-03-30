const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");

const path=require("path");
 
 
const multer = require("multer");
const PDFDocument = require("pdfkit");
const PptxGenJS = require("pptxgenjs");
const { exec } = require("child_process");


require("dotenv").config();

const sizeOf = require("image-size");

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






// Update slides
app.post("/update-slides", (req, res) => {
  try {
    const { topic, slides, useImages } = req.body;
    const jsonPath = path.join("/tmp", `${topic.replace(/\s/g, "_")}.json`);

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
Generate a PowerPoint presentation on **"${topic}"** with exactly ${slidesCount} slides.

### **Slide Structure**:
1. **Slide Title**: Format as "**Slide X: Title**".
2. **Explanation**: Provide clear, structured bullet points.
3. **Code Snippets**: Format code properly using **"${topic.toLowerCase()}"** syntax.

### **Example:**
---
#### **Slide 1: Introduction to ${topic}**
- ${topic} is a widely used programming language.
- It is used in web development, automation, and AI.

#### **Slide 2: Hello World Example**
**Explanation:**
- A simple program to print "Hello, World!" in ${topic}.

\`\`\`${topic.toLowerCase()}
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
\`\`\`

#### **Slide 3: Variables and Data Types**
**Explanation:**
- ${topic} supports multiple data types such as int, double, and boolean.

**Example Code:**
\`\`\`${topic.toLowerCase()}
int age = 25;
double price = 19.99;
boolean isAvailable = true;
\`\`\`

Ensure proper **formatting, clarity, and well-structured slides**.
`;
    } else {
        prompt = `
Generate a structured PowerPoint presentation on **"${topic}"** with exactly ${slidesCount} slides.

### **Slide Structure**:
1. **Slide Title**: Format as "**Slide X: Title**".
2. **Content**: Bullet points explaining key concepts in simple terms.

### **Example:**
---
#### **Slide 1: Introduction to ${topic}**
- Definition of ${topic}.
- Importance and real-world applications.

#### **Slide 2: Key Features**
- Feature 1: Explanation.
- Feature 2: Explanation.

Ensure the response **follows this structured format**.
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





// Generate and Download PPT
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

        slidePpt.addText(slide.title, {
            x: 0.5, y: 0.5, w: "90%",
            fontSize: 28, bold: true,
            color: slide.titleColor || "#D63384",
            align: "left", fontFace: "Arial Black"
        });

        let formattedContent = slide.content.map(point => `🔹 ${point}`).join("\n");

        if (slide.image) {
            slidePpt.addText(formattedContent, { x: 0.5, y: 1.5, w: "70%", h: 3.5, fontSize: 20, color: "#333" ,fontFamily: "Playfair Display"});
            slidePpt.addImage({ path: slide.image, x: 7.36, y: 1.5, w: 2.5, h: 2.5 });
        } else {
            slidePpt.addText(formattedContent, { x: 0.5, y: 1.5, w: "95%", h: 3.5, fontSize: 20, color: "#333" ,fontFamily: "Playfair Display"
 });
        }
    });

    const pptPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.pptx`);

    await pptx.writeFile(pptPath);
    
    // Wait for the file to be completely written
    let retries = 0;
    while (!fs.existsSync(pptPath) && retries < 5) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        retries++;
    }

    res.download(pptPath);
});





// Start Server
app.listen(5000, () => console.log(`✅ Server running on port 5000`));
