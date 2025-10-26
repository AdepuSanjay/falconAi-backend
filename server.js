// server.js
// -------------------------------------------------------------
const express = require("express");
const cors = require("cors");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();
const Razorpay = require("razorpay");

const app = express();

// --------- CORS ---------
app.use(
  cors({
    origin: [
      "https://www.falconai.space",
      "https://firebrik.vercel.app",
      "https://sparcx.vercel.app",
    ],
    methods: ["GET", "POST"],
  })
);
app.use(express.json());

// --------- KEYS ---------
const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ GOOGLE_GEMINI_API_KEY missing in .env");
  process.exit(1);
}
const GEMINI_MODEL = "gemini-2.0-flash";

const razorpay = new Razorpay({
  key_id: "your_key_id_here",
  key_secret: "your_key_secret_here",
});

// --------- GEMINI HELPER ---------
async function callGemini(prompt, systemText) {
  const body = {
    system_instruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  const data = await resp.json();
  if (!resp.ok) {
    const msg =
      data.error?.message ||
      data.promptFeedback?.blockReason ||
      data.candidates?.[0]?.finishReason ||
      "Unknown Gemini error";
    throw Object.assign(new Error(msg), { status: resp.status, raw: data });
  }
  return data;
}

// --------- CONTACT FORM ---------
app.post("/api/contact", async (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !phone || !message) {
    return res
      .status(400)
      .json({ success: false, error: "All fields are required" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "adepusanjay444@gmail.com",
        pass: "lrnesuqvssiognej", // App password
      },
    });

    await transporter.sendMail({
      from: email,
      to: "adepusanjay444@gmail.com",
      subject: "New Contact Form Submission",
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nMessage: ${message}`,
    });

    res.json({ success: true, message: "Message sent successfully!" });
  } catch (err) {
    console.error("Mailer Error:", err.message);
    res.status(500).json({ success: false, error: "Failed to send message" });
  }
});

// --------- MEDICAL CHAT ---------
app.post("/medical-chat", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const medicalKeywords = [
    "symptoms",
    "diagnosis",
    "treatment",
    "disease",
    "medicine",
    "health",
    "therapy",
    "anatomy",
    "pharmacology",
    "pathology",
    "nursing",
    "infection",
    "injury",
    "surgery",
    "physiology",
    "public health",
    "clinical",
    "doctor",
    "nurse",
  ];
  const isMedical = medicalKeywords.some((w) =>
    prompt.toLowerCase().includes(w)
  );

  const chatPrompt = isMedical
    ? `You are a medical assistant. Provide clear, medically accurate, patient-friendly information:\n\n${prompt}`
    : prompt;

  try {
    const data = await callGemini(chatPrompt);
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response available.";
    res.json({ success: true, response: reply });
  } catch (err) {
    console.error("Medical Chat Error:", err.message);
    res.status(500).json({ error: "AI service failed to respond." });
  }
});

// --------- SLIDES (CRUD) ---------
app.get("/get-previous-slides", (req, res) => {
  try {
    const files = fs.readdirSync("/tmp").filter((f) => f.endsWith(".json"));
    const previousSlides = files.map((file) => ({
      topic: file.replace(".json", "").replace(/_/g, " "),
      path: file,
    }));
    res.json({ success: true, previousSlides });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch previous slides" });
  }
});

app.get("/get-slides/:topic", (req, res) => {
  const topic = req.params.topic;
  const jsonPath = path.join("/tmp", `${topic.replace(/\s/g, "_")}.json`);
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ error: "No slides found for this topic" });
  }
  const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  res.json({ success: true, slides });
});

app.post("/update-slides", (req, res) => {
  try {
    let { topic, slides, useImages } = req.body;
    if (!topic) return res.status(400).json({ error: "Topic is required" });
    if (!slides?.length)
      return res.status(400).json({ error: "No slides to save" });

    const jsonPath = path.join("/tmp", `${topic.replace(/\s+/g, "_")}.json`);
    const formatted = slides.map((s) => ({
      title: s.title || "Untitled Slide",
      content: (s.content || []).filter((t) => t.trim() !== ""),
      theme: s.theme || "#FFFFFF",
      titleColor: s.titleColor || "#000000",
      contentColor: s.contentColor || "#000000",
      image: useImages ? s.image || null : null,
    }));
    fs.writeFileSync(jsonPath, JSON.stringify(formatted, null, 2), "utf-8");
    res.json({ success: true, message: "Slides updated successfully!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update slides" });
  }
});

// --------- DOWNLOAD PPT ---------
app.get("/download-ppt/:topic", async (req, res) => {
  const topic = req.params.topic;
  const jsonPath = path.join("/tmp", `${topic.replace(/\s/g, "_")}.json`);
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ error: "No slides found for this topic" });
  }

  try {
    const slides = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    const pptx = new PptxGenJS();

    slides.forEach((slide) => {
      let slidePpt = pptx.addSlide();
      slidePpt.background = slide.theme?.startsWith("http")
        ? { path: slide.theme }
        : { color: slide.theme || "#FFF" };

      slidePpt.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: slide.image ? "60%" : "86%",
        fontSize: 22,
        bold: true,
        color: slide.titleColor || "#000",
      });

      let content = slide.content.map((c) => `🔹 ${c}`).join("\n");
      slidePpt.addText(content, {
        x: 0.5,
        y: slide.image ? 0.5 : 1.5,
        w: 6,
        fontSize: 18,
        color: slide.contentColor || "#333",
        lineSpacing: 24,
      });

      if (slide.image) {
        slidePpt.addImage({ path: slide.image, x: 7, y: 0, w: 3, h: 5.6 });
      }
    });

    const fileName = `${topic.replace(/\s/g, "_")}.pptx`;
    const filePath = path.join("/tmp", fileName);
    await pptx.writeFile({ fileName: filePath });

    res.download(filePath, fileName);
  } catch (err) {
    console.error("PPT Error:", err.message);
    res.status(500).json({ error: "Failed to generate PPT" });
  }
});

// --------- PARSER ---------
function parseGeminiResponse(txt) {
  const slides = [];
  const sections = txt.split("Slide ");
  sections.forEach((sec) => {
    const match = sec.match(/^(\d+):\s*(.+)/);
    if (match) {
      const title = match[2].replace(/\*\*/g, "").trim();
      const lines = sec.split("\n").slice(1).map((l) => l.trim());
      const content = lines.filter((l) => l && !l.startsWith("```"));
      slides.push({ title, content });
    }
  });
  return slides.length ? { slides } : { error: "Invalid format" };
}

// --------- GENERATE PPT (AI) ---------
app.post("/generate-ppt", async (req, res) => {
  const { topic, slidesCount } = req.body;
  if (!topic || !slidesCount)
    return res.status(400).json({ error: "topic and slidesCount required" });

  const prompt = `Generate a PowerPoint on "${topic}" with exactly ${slidesCount} slides.
Each slide must be formatted as:
Slide N: Title
- Point 1
- Point 2
- Point 3
- Point 4`;

  try {
    const data = await callGemini(prompt);
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = parseGeminiResponse(aiText);
    if (parsed.error) return res.status(500).json({ error: parsed.error });
    res.json(parsed);
  } catch (err) {
    console.error("Gemini Error:", err.message);
    res.status(500).json({ error: "Failed to generate slides" });
  }
});

// --------- AI SEARCH ---------
app.post("/ai-search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "Query is required" });

  const idQs = ["who are you", "who built you", "who developed you", "what is your name"];
  if (idQs.some((q) => query.toLowerCase().includes(q))) {
    return res.json({
      query,
      response: "I am a Falcon AI assistant, developed by Adepu Sanjay.",
    });
  }

  try {
    const data = await callGemini(query);
    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No relevant information.";
    res.json({ query, response: reply });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch results" });
  }
});

// --------- START ---------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);