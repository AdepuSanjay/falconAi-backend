const express = require("express");
const cors = require("cors");

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();
const Razorpay = require('razorpay');

const app = express();
app.use(cors({ origin: "https://falconai.vercel.app", methods: ["GET", "POST"] }));
app.use(express.json());

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
    console.error("❌ Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}



const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

const razorpay = new Razorpay({
  key_id: 'your_key_id_here',  // Replace with your actual Razorpay Key ID
  key_secret: 'your_key_secret_here',  // Replace with your actual Razorpay Key Secret
});

app.post('/create-order', async (req, res) => {
  const { amount, currency } = req.body;
  
  const options = {
    amount: amount * 100, // Convert to paise (₹1 = 100 paise)
    currency,
    receipt: `order_rcptid_${Date.now()}`
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).send(error);
  }
});











//get list of previous ppts 

app.get("/get-previous-slides", (req, res) => {
    try {
        const files = fs.readdirSync("/tmp").filter(file => file.endsWith(".json"));
        if (files.length === 0) {
            return res.json({ success: true, slides: [] });
        }

        const previousSlides = files.map(file => {
            const topic = file.replace(".json", "").replace(/_/g, " ");
            return { topic, path: file };
        });

        res.json({ success: true, previousSlides });
    } catch (error) {
        console.error("Error fetching previous slides:", error.message);
        res.status(500).json({ error: "Failed to fetch previous slides" });
    }
});




// Fetch slides
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

// Translate text
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



// Update slides
app.post("/update-slides", (req, res) => {
try {
let { topic, slides, useImages } = req.body;

if (!topic) {  
        return res.status(400).json({ error: "Topic is required" });  
    }  

    topic = topic.trim(); // Remove spaces at the start and end  
    const jsonPath = path.join("/tmp", `${topic.replace(/\s+/g, "_")}.json`);  

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


// Download PPT
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
        slidePpt.background = { color: slide.theme || "#dde6ed" };  

        slidePpt.addText(slide.title, {  
            x: 0.5, y: 0.5, w: "90%",  
            fontSize: 28, bold: true,  
            color: slide.titleColor || "#D63384",  
            align: "left", fontFace: "Arial Black"  
        });  

        let formattedContent = slide.content.map(point => `🔹 ${point}`).join("\n");  

       if (slide.image) {
    const imageWidth = 3;
    const imageHeight = 5.25; // Full height
    const slideWidth = 10; // Default width
    const margin = 0.5;
    const textWidth = slideWidth - imageWidth - (margin * 2); // Remaining width after image and margins

    slidePpt.addText(formattedContent, {
        x: margin,
        y: margin,
        w: textWidth,
        h: imageHeight - (margin * 2),
        fontSize: 20,
        color: slide.contentColor || "#333333",
        fontFace: "Arial",
        lineSpacing: 28,
        align: "left"
    });

    slidePpt.addImage({
        path: slide.image,
        x: slideWidth - imageWidth,
        y: 0,
        w: imageWidth,
        h: imageHeight
    });
} else {
    slidePpt.addText(formattedContent, {
        x: 0.5, y: 1.5, w: "95%", h: 3.5,
        fontSize: 20,
        color: slide.contentColor || "#333333",
        fontFace: "Arial",
        lineSpacing: 28,
        align: "left"
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





// Parse AI response


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

// Generate PPT using AI
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
2. Content: Provide **exactly 4 to 5 bullet points** explaining key concepts in simple terms. Every slide must have at least 4 points.

Ensure that the number of points remains consistent across all slides, even if there are more than 14 slides.

Example:

Slide 1: Introduction to ${topic}

- Definition of ${topic}.
- Importance and real-world applications.
- How it impacts various industries.
- Key reasons why ${topic} is relevant today.
- Future scope and advancements.

Slide 2: Key Features

- Feature 1: Explanation.
- Feature 2: Explanation.
- Feature 3: Explanation.
- Feature 4: Explanation.
- Feature 5: Explanation.
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


// ✅ AI-Powered Search using Google Gemini with Context Handling
app.post("/ai-search", async (req, res) => {
    try {
        const { query, sessionId } = req.body;
        if (!query) return res.status(400).json({ error: "Query is required" });

        // Generate session ID if not provided
        const userSessionId = sessionId || uuidv4();
        const sessionFilePath = path.join("/tmp", `${userSessionId}.json`);

        let chatHistory = [];

        // Load previous conversations if session exists
        if (fs.existsSync(sessionFilePath)) {
            chatHistory = JSON.parse(fs.readFileSync(sessionFilePath, "utf-8"));
        }

        // Format previous conversation for AI
        const historyText = chatHistory
            .map((entry) => `User: ${entry.query}\nAI: ${entry.response}`)
            .join("\n");

        const prompt = historyText
            ? `Previous conversation:\n${historyText}\n\nUser: ${query}\nAI:`
            : query;

        // Send request to Gemini API
        const response = await axios.post(
            `${GEMINI_API_URL}?key=${GOOGLE_GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: prompt }] }] },
            { headers: { "Content-Type": "application/json" } }
        );

        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No relevant information found.";

        // Save current query & response in session history
        chatHistory.push({ query, response: aiResponse });

        // Store updated session history
        fs.writeFileSync(sessionFilePath, JSON.stringify(chatHistory, null, 2), "utf-8");

        res.json({ sessionId: userSessionId, query, response: aiResponse });

    } catch (error) {
        console.error("AI Search Error:", error.message);
        res.status(500).json({ error: "Failed to fetch search results" });
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));