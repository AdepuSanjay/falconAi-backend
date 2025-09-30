const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();
const Razorpay = require("razorpay");

const app = express();

app.use(
  cors({
    origin: [
      "https://www.falconai.space",
      "https://firebrik.vercel.app",
      "https://sparcx.vercel.app"
    ],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
  console.error("❌ Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
  process.exit(1);
}

// Use the correct Gemini API endpoint
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "your_key_id_here",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "your_key_secret_here",
});

// Improved Gemini API call function
async function callGeminiAPI(prompt) {
  try {
    const response = await axios.post(
      GEMINI_API_URL,
      {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000 // 30 second timeout
      }
    );

    if (response.data && response.data.candidates && response.data.candidates[0]) {
      return response.data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Unexpected response format from Gemini API");
    }
  } catch (error) {
    console.error("Gemini API Error Details:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      url: GEMINI_API_URL
    });
    
    if (error.response) {
      // Server responded with error status
      throw new Error(`Gemini API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // Request was made but no response received
      throw new Error("No response received from Gemini API. Check your network connection.");
    } else {
      // Other errors
      throw new Error(`Gemini API call failed: ${error.message}`);
    }
  }
}

// Contact Form (unchanged)
app.post("/api/contact", async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !email || !phone || !message) {
    return res.status(400).json({ success: false, error: "All fields are required" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "adepusanjay444@gmail.com",
        pass: "lrnesuqvssiognej",
      },
    });

    const mailOptions = {
      from: email,
      to: "adepusanjay444@gmail.com",
      subject: "New Contact Form Submission",
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nMessage: ${message}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "Message sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ success: false, error: "Failed to send message" });
  }
});

// Updated Medical Chat endpoint
app.post("/medical-chat", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const medicalKeywords = [
    "symptoms", "diagnosis", "treatment", "disease", "medicine", 
    "health", "therapy", "anatomy", "pharmacology", "pathology", 
    "nursing", "infection", "injury", "surgery", "physiology", 
    "public health", "clinical", "doctor", "nurse"
  ];

  const isMedicalQuery = medicalKeywords.some((word) => 
    prompt.toLowerCase().includes(word)
  );

  let chatPrompt;

  if (isMedicalQuery) {
    chatPrompt = `You are a medical assistant. Answer the following question with medically accurate and patient-friendly explanations:

${prompt}

If it's about symptoms, explain possible causes.
If it's about treatment, mention standard approaches.
Avoid diagnosing, just provide useful medical knowledge.`;
  } else {
    chatPrompt = prompt;
  }

  try {
    const aiResponse = await callGeminiAPI(chatPrompt);
    res.json({ success: true, response: aiResponse });
  } catch (error) {
    console.error("Medical Chat Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Updated Translate endpoint
app.post("/translate", async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguage } = req.body;
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: "Text and targetLanguage are required" });
    }

    let prompt = sourceLanguage
      ? `Translate the following text from ${sourceLanguage} to ${targetLanguage}: ${text}`
      : `Translate the following text to ${targetLanguage}: ${text}`;

    const translatedText = await callGeminiAPI(prompt);
    res.json({ success: true, translatedText });
  } catch (error) {
    console.error("Translation Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Updated Generate PPT endpoint
app.post("/generate-ppt", async (req, res) => {
  const { topic, slidesCount } = req.body;

  if (!topic || !slidesCount) {
    return res.status(400).json({ error: "Missing required fields: topic and slidesCount" });
  }

  const isCodingTopic = [
    "Java", "Python", "JavaScript", "C++", "C#", "React", "Node.js", "PHP",
  ].some((lang) => topic.toLowerCase().includes(lang.toLowerCase()));

  let prompt;

  if (isCodingTopic) {
    prompt = `
Generate a PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.

Slide Structure:

1. Slide Title: Format as "Slide X: Title".

2. Explanation: Use clear, structured bullet points (max 3 per slide).

3. Code Snippets: Include only one small example per slide, not exceeding 4 lines.

Example:

Slide 2: Hello World Example

Basic syntax of ${topic}.

How to print output.

Entry point of the program.

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

2. Content: Provide exactly 4 to 5 bullet points explaining key concepts in simple terms. 
Ensure every slide has 4-5 points even if more than 14 slides.

Example:

Slide 1: Introduction to ${topic}

Definition of ${topic}.

Importance and real-world applications.

How it impacts various industries.

Key reasons why ${topic} is relevant today.

Future scope and advancements.
`;
  }

  try {
    const aiText = await callGeminiAPI(prompt);
    const formattedSlides = parseGeminiResponse(aiText);

    if (formattedSlides.error) {
      return res.status(500).json({ error: "Unexpected AI response. Please try again." });
    }

    return res.json(formattedSlides);
  } catch (error) {
    console.error("Error generating PPT:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

// Updated AI Search endpoint
app.post("/ai-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });

    const lowerQuery = query.toLowerCase();
    const identityQuestions = [
      "who are you",
      "who built you",
      "who developed you",
      "what is your name",
      "who created you",
    ];

    if (identityQuestions.some((q) => lowerQuery.includes(q))) {
      return res.json({
        query,
        response: "I am a large model of Falcon, developed by Adepu Sanjay.",
      });
    }

    const aiResponse = await callGeminiAPI(query);
    res.json({ query, response: aiResponse });
  } catch (error) {
    console.error("AI Search Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Keep all your existing helper functions and other endpoints the same
// (parseGeminiResponse, get-previous-slides, get-slides, update-slides, download-ppt)

function parseGeminiResponse(responseText) {
  const slides = [];
  const slideSections = responseText.split("Slide ");

  slideSections.forEach((section) => {
    const match = section.match(/^(\d+):\s*(.+)/);
    if (match) {
      const title = match[2].replace(/\*\*/g, "").trim();
      const lines = section.split("\n").slice(1).map((line) => line.trim());
      const content = [];
      let isCodeBlock = false;

      lines.forEach((line) => {
        if (line.startsWith("```")) {
          isCodeBlock = !isCodeBlock;
        } else if (isCodeBlock) {
          if (line) content.push(line);
        } else if (line && line !== "**") {
          content.push(line.replace(/^-\s*/, ""));
        }
      });

      slides.push({ title, content });
    }
  });

  return slides.length ? { slides } : { error: "Invalid AI response format" };
}

// Add these endpoints back (they were working fine)
app.get("/get-previous-slides", (req, res) => {
  try {
    const files = fs.readdirSync("/tmp").filter((file) => file.endsWith(".json"));
    const previousSlides = files.map((file) => ({
      topic: file.replace(".json", "").replace(/_/g, " "),
      path: file,
    }));

    res.json({ success: true, previousSlides });
  } catch (error) {
    console.error("Error fetching previous slides:", error.message);
    res.status(500).json({ error: "Failed to fetch previous slides" });
  }
});

app.get("/get-slides/:topic", (req, res) => {
  try {
    const topic = req.params.topic;
    const jsonPath = path.join("/tmp", `${topic.replace(/\s/g, "_")}.json`);

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
    let { topic, slides, useImages } = req.body;

    if (!topic) return res.status(400).json({ error: "Topic is required" });
    if (!slides || slides.length === 0)
      return res.status(400).json({ error: "No slides to save" });

    topic = topic.trim();
    const jsonPath = path.join("/tmp", `${topic.replace(/\s+/g, "_")}.json`);

    const formattedSlides = slides.map((slide) => ({
      title: slide.title || "Untitled Slide",
      content: (slide.content || []).filter((text) => text.trim() !== ""),
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

app.get("/download-ppt/:topic", async (req, res) => {
  try {
    const topic = req.params.topic;
    const jsonPath = path.join("/tmp", `${topic.replace(/\s/g, "_")}.json`);

    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: "No slides found for this topic" });
    }

    const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    let pptx = new PptxGenJS();

    slides.forEach((slide) => {
      let slidePpt = pptx.addSlide();

      slidePpt.background = slide.theme?.startsWith("http")
        ? { path: slide.theme }
        : { color: slide.theme || "#FFFFFF" };

      const titleWidth = slide.image ? "60%" : "86%";

      slidePpt.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: titleWidth,
        fontSize: 22,
        bold: true,
        color: slide.titleColor || "#D63384",
        align: "left",
        fontFace: "Calibri",
      });

      let formattedContent = slide.content.flatMap((point) => {
        if (point.includes(":")) {
          const [label, rest] = point.split(/:(.*)/);
          return [
            { text: `🔹 ${label.trim()}: `, options: { bold: true } },
            { text: `${rest.trim()}\n` },
          ];
        } else {
          return [{ text: `🔹 ${point}\n` }];
        }
      });

      if (slide.image) {
        slidePpt.addText(formattedContent, {
          x: 0.5,
          y: 0.5,
          w: 6,
          h: 5,
          fontSize: 15,
          color: slide.contentColor || "#333333",
          fontFace: "Calibri",
          lineSpacing: 26,
          align: "left",
        });

        slidePpt.addImage({
          path: slide.image,
          x: 7,
          y: 0,
          w: 3,
          h: 5.62,
        });
      } else {
        slidePpt.addText(formattedContent, {
          x: 0.5,
          y: 1.5,
          w: "95%",
          h: 3.5,
          fontSize: 20,
          color: slide.contentColor || "#333333",
          fontFace: "Calibri",
          lineSpacing: 28,
          align: "left",
        });
      }
    });

    const pptFileName = `${topic.replace(/\s/g, "_")}.pptx`;
    const pptFilePath = path.join("/tmp", pptFileName);

    await pptx.writeFile({ fileName: pptFilePath });

    res.download(pptFilePath, pptFileName, (err) => {
      if (err) {
        console.error("Error downloading PPT:", err.message);
        res.status(500).json({ error: "Failed to download PPT" });
      }
    });
  } catch (error) {
    console.error("Error generating PPT:", error.message);
    res.status(500).json({ error: "Failed to generate PPT" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));