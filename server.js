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


const upload = multer({ dest: "uploads/" }); // Move this line up


// Ensure 'uploads' & 'compressed_videos' directories exist
if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");
if (!fs.existsSync("./compressed_videos")) fs.mkdirSync("./compressed_videos");


// Ensure 'generated_resumes' folder exists
if (!fs.existsSync("./generated_resumes")) fs.mkdirSync("./generated_resumes");




/**
 * Generates a professional resume using Gemini AI
 */
app.post("/generate-resume", async (req, res) => {
    try {
        const { name, email, phone, linkedin, github, summary, experience, skills, education, projects, certifications, achievements, languages } = req.body;

        if (!name || !email || !phone || !summary || !experience || !skills || !education) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const prompt = `
Generate a **professional, ATS-optimized resume** with only the given details, without placeholders or instructions.

**Personal Details:**
- **Name:** ${name}
- **Email:** ${email}
- **Phone:** ${phone}
- **LinkedIn:** ${linkedin || "N/A"}
- **GitHub:** ${github || "N/A"}

**Professional Summary:**  
${summary}

**Work Experience:**  
${experience.map(exp => `- **${exp.position}** at ${exp.company} (${exp.duration})  
  *${exp.responsibilities}*`).join("\n")}

**Education:**  
${education.map(edu => `- **${edu.degree}**, ${edu.institution} (${edu.year})`).join("\n")}

**Projects:**  
${projects.map(proj => `- **${proj.title}**  
  *Description:* ${proj.description}  
  *Tech Stack:* ${proj.techStack}`).join("\n")}

**Certifications:**  
${certifications.length > 0 ? certifications.map(cert => `- ${cert}`).join("\n") : "N/A"}

**Achievements:**  
${achievements.length > 0 ? achievements.map(ach => `- ${ach}`).join("\n") : "N/A"}

**Skills:**  
${skills.length > 0 ? skills.join(", ") : "N/A"}

**Languages:**  
${languages.length > 0 ? languages.join(", ") : "N/A"}

Format this in a clean, professional, ATS-friendly style.
`;
        const response = await axios.post(
            `${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] }
        );

        const aiResume = response.data.candidates[0].content.parts[0].text;

        // Save resume as a text file (optional)
        const textFilePath = `generated_resumes/resume_${Date.now()}.txt`;
        fs.writeFileSync(textFilePath, aiResume);

        res.json({ message: "Resume generated successfully", resume: aiResume });
    } catch (error) {
        console.error("Error generating resume:", error);
        res.status(500).json({ error: "Failed to generate resume" });
    }
});

/**
 * Converts AI-generated resume into a downloadable PDF
 */
app.post("/generate-pdf", (req, res) => {
    try {
        const { resumeContent, fileName } = req.body;
        if (!resumeContent || !fileName) return res.status(400).json({ error: "Invalid data" });

        const doc = new PDFDocument();
        const pdfPath = `generated_resumes/${fileName}.pdf`;
        const stream = fs.createWriteStream(pdfPath);

        doc.pipe(stream);
        doc.fontSize(12).text(resumeContent, { align: "left" });
        doc.end();

        stream.on("finish", () => {
            res.json({ message: "PDF created", downloadUrl: `https://falconai-backend.onrender.com/download/${fileName}.pdf` });
        });
    } catch (error) {
        console.error("Error generating PDF:", error);
        res.status(500).json({ error: "PDF generation failed" });
    }
});

/**
 * Endpoint to download resume PDFs
 */
app.get("/download/:filename", (req, res) => {
    const filePath = path.join(__dirname, "generated_resumes", req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: "File not found" });
    }
});


app.post("/generate-content", async (req, res) => {
    try {
        const { videoTitle, videoKeywords, language } = req.body;

        if (!videoTitle) {
            return res.status(400).json({ error: "Video title is required." });
        }

        // Default to English if no language is specified
        const targetLanguage = language || "English";

        // AI Prompt with structured formatting
        const prompt = `
        Generate an engaging YouTube caption, SEO-optimized hashtags, and a detailed description for the following video in ${targetLanguage}:
        - **Title:** ${videoTitle}
        - **Keywords:** ${videoKeywords || "None"}

        Format (strictly follow this structure without additional formatting):
        Caption: [short catchy caption]
        Hashtags: [comma-separated hashtags]
        Description: [detailed SEO-friendly description]
        `;

        // Send request to Google Gemini API
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            }
        );

        const aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!aiResponse) {
            return res.status(500).json({ error: "Failed to generate content." });
        }

        // Extract caption, hashtags, and description
        const captionMatch = aiResponse.match(/Caption:\s*(.*)/);
        const hashtagsMatch = aiResponse.match(/Hashtags:\s*(.*)/);
        const descriptionMatch = aiResponse.match(/Description:\s*([\s\S]*)/);

        const caption = captionMatch ? captionMatch[1].trim() : "";
        const hashtags = hashtagsMatch ? hashtagsMatch[1].trim() : "";
        const description = descriptionMatch ? descriptionMatch[1].trim() : "";

        res.json({ caption, hashtags, description });

    } catch (error) {
        console.error("Error generating content:", error);
        res.status(500).json({ error: "Internal server error." });
    }
});





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
    const { topic, slides, useImages } = req.body;  
    const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);  
  
    if (!slides || slides.length === 0) {  
      return res.status(400).json({ error: "No slides to save" });  
    }  

    const formattedSlides = slides.map((slide) => ({  
      title: slide.title || "Untitled Slide",  
      content: slide.content || [],  
      theme: slide.theme || "#FFFFFF",  
      titleColor: slide.titleColor || "#000000",  
      contentColor: slide.contentColor || "#000000",  
      image: useImages ? slide.image || null : null, // Save image only if useImages is true  
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




// Generate and Download PDF
app.get("/download-pdf/:topic", (req, res) => {
    const topic = req.params.topic;
    const jsonPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.json`);

    if (!fs.existsSync(jsonPath)) {
        return res.status(404).json({ error: "No slides found for this topic" });
    }

    const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const doc = new PDFDocument();
    const pdfPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.pdf`);

    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    const pageHeight = 840; // Standard A4 page height for PDF
    const margin = 40; // Margin for text

    slides.forEach((slide, index) => {
        // Title Positioning
        doc.fontSize(28).font("Arial-Bold")
            .text(slide.title, margin, margin, { width: 520, lineBreak: true });
        
        let yPosition = margin + 40; // Adjust the Y position after the title

        // Content Formatting (Bullet Points)
        let contentFont = "Arial";
        let formattedContent = slide.content.map(point => `🔹 ${point}`).join("\n");
        
        // Check if there's an image and handle accordingly
        if (slide.image) {
            // Add content text on the left side (taking up 70% of the width)
            doc.fontSize(20).font(contentFont)
                .text(formattedContent, margin, yPosition, { width: 340, lineBreak: true, paragraphGap: 6 });

            // Add image on the right (taking up 30% of the width)
            const imgPath = slide.image; // Ensure this path is correct and accessible
            const dimensions = sizeOf(imgPath);
            const imageHeight = dimensions.height > 150 ? 150 : dimensions.height; // Resize if too large
            doc.image(imgPath, 380, yPosition, { width: 150, height: imageHeight });

            yPosition += Math.max(imageHeight, 120); // Update yPosition after the image
        } else {
            // No image, expand text to full width
            doc.fontSize(20).font(contentFont)
                .text(formattedContent, margin, yPosition, { width: 520, lineBreak: true, paragraphGap: 6 });
            yPosition += 160; // Space between text blocks
        }

        // If not the last slide, add a page break
        if (index < slides.length - 1) {
            doc.addPage();
            yPosition = margin; // Reset yPosition for the next page
        }
    });

    doc.end();

    // Wait for the PDF file to be completely written before sending the response
    writeStream.on("finish", () => {
        res.download(pdfPath, (err) => {
            if (err) console.error("Error sending PDF:", err);
            else fs.unlinkSync(pdfPath); // Delete the file after download
        });
    });
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
                x: 7.20, y: 1.5, w: 2.5, h: 2.5  // Image moved 5px left  
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

    const pptPath = path.join(__dirname, "generated_ppts", `${topic.replace(/\s/g, "_")}.pptx`);  
    await pptx.writeFile(pptPath);  
    res.download(pptPath);  
});


app.post("/solve-math", upload.single("image"), async (req, res) => {
    try {
        let problem = req.body.problem?.trim() || "";

        if (req.file) {
            // Perform OCR with preprocessing
            const { data: { text } } = await Tesseract.recognize(req.file.path, "eng", {
                tessedit_char_whitelist: "0123456789+-*/=()xX",
                oem: 1,  // Best mode for handwritten text
                psm: 6   // Assume a single block of text
            });

            problem = text.replace(/\s+/g, " ").trim();
            fs.unlinkSync(req.file.path); // Clean up the uploaded file
        }

        if (!problem) {
            return res.status(400).json({ error: "Math problem is required (text or image)." });
        }

        const prompt = `Solve the following math problem step by step:\n\n${problem}`;

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { "Content-Type": "application/json" } }
        );

        const solution = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Solution not found.";

        res.json({ success: true, problem, solution });

    } catch (error) {
        console.error("Math Solver Error:", error);
        res.status(500).json({ error: "Failed to solve math problem. Please try again." });
    }
});

    


// Start Server
app.listen(5000, () => console.log(`✅ Server running on port 5000`));
