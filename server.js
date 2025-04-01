const express = require("express");
const cors = require("cors");

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();

const { Client } = require('node-ssdp');
const WebSocket = require('ws');
const http = require('http');
const socketIO = require('socket.io');


const app = express();
app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));
app.use(express.json());

const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!GOOGLE_GEMINI_API_KEY) {
    console.error("❌ Error: GOOGLE_GEMINI_API_KEY is missing in .env file.");
    process.exit(1);
}




// Create an HTTP server and set up Socket.IO
const server = http.createServer(app);
const io = socketIO(server);

// SSDP client for discovering devices
const client = new Client();
let devices = [];

// Function to discover Android TV devices on the network
client.on('response', (headers, statusCode, rinfo) => {
  if (headers['server'] && headers['server'].includes('Android TV')) {
    // Adding device to list of discovered Android TVs
    const device = { name: headers['st'], ip: rinfo.address };
    devices.push(device);
    io.emit('discoverTV', device); // Emit event to frontend
  }
});

// Start searching for devices on the network (every 10 seconds)
client.search('ssdp:all');
setInterval(() => {
  devices = []; // Clear previous devices list
  client.search('ssdp:all'); // Re-search for devices
}, 10000);

// WebSocket connection handler
let tvSockets = {}; // Store WebSocket connections for each Android TV IP

// When a frontend client connects
io.on('connection', (socket) => {
  console.log('Frontend connected');

  // Emit discovered devices to the frontend
  socket.emit('discoverTVList', devices);

  // When frontend selects an Android TV device to connect to
  socket.on('connectToTV', (deviceIp) => {
    if (tvSockets[deviceIp]) {
      console.log(`Already connected to Android TV at ${deviceIp}`);
      socket.emit('connectedToTV', deviceIp);
    } else {
      // Create a WebSocket connection to the Android TV (assuming port 8080 for WebSocket)
      const tvSocket = new WebSocket(`ws://${deviceIp}:8080`);
      
      tvSocket.onopen = () => {
        console.log(`Connected to Android TV at ${deviceIp}`);
        tvSockets[deviceIp] = tvSocket; // Store the connection
        socket.emit('connectedToTV', deviceIp); // Notify frontend
      };

      tvSocket.onerror = (error) => {
        console.error(`Error connecting to Android TV at ${deviceIp}: ${error}`);
        socket.emit('errorConnecting', deviceIp);
      };

      tvSocket.onclose = () => {
        console.log(`Connection to Android TV at ${deviceIp} closed`);
        delete tvSockets[deviceIp]; // Clean up on close
      };

      tvSocket.onmessage = (message) => {
        console.log(`Received from Android TV at ${deviceIp}: ${message.data}`);
      };
    }
  });

  // Handle control commands from frontend (e.g., 'up', 'down', 'play')
  socket.on('controlCommand', (deviceIp, command) => {
    if (tvSockets[deviceIp]) {
      const tvSocket = tvSockets[deviceIp];
      if (tvSocket.readyState === WebSocket.OPEN) {
        tvSocket.send(command);
        console.log(`Sent command: ${command} to Android TV at ${deviceIp}`);
      } else {
        console.log(`Connection to Android TV at ${deviceIp} is not open`);
      }
    } else {
      console.log(`No connection to Android TV at ${deviceIp}`);
    }
  });
});

// HTTP Endpoints to test via API Client (Postman/Insomnia)

// Endpoint to get the list of discovered Android TVs
app.get('/discoverTVs', (req, res) => {
  res.json({ devices });
});

// Endpoint to simulate control command (for testing purposes)
app.post('/controlCommand', (req, res) => {
  const { deviceIp, command } = req.body;
  if (tvSockets[deviceIp]) {
    const tvSocket = tvSockets[deviceIp];
    if (tvSocket.readyState === WebSocket.OPEN) {
      tvSocket.send(command);
      res.status(200).json({ message: `Sent command: ${command} to Android TV at ${deviceIp}` });
    } else {
      res.status(400).json({ message: `Connection to Android TV at ${deviceIp} is not open` });
    }
  } else {
    res.status(404).json({ message: `No connection to Android TV at ${deviceIp}` });
  }
});












const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

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
                slidePpt.addText(formattedContent, {
                    x: 0.5, y: 1.5, w: "70%", h: 3.5,
                    fontSize: 20, color: slide.contentColor || "#333333",
                    fontFace: "Arial", lineSpacing: 28, align: "left"
                });

                slidePpt.addImage({
                    path: slide.image,
                    x: 7.36, y: 1.5, w: 2.5, h: 2.5
                });
            } else {
                slidePpt.addText(formattedContent, {
                    x: 0.5, y: 1.5, w: "95%", h: 3.5,
                    fontSize: 20, color: slide.contentColor || "#333333",
                    fontFace: "Arial", lineSpacing: 28, align: "left"
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
2. Content: Bullet points explaining key concepts in simple terms.

Example:

Slide 1: Introduction to ${topic}

- Definition of ${topic}.
- Importance and real-world applications.

Slide 2: Key Features

- Feature 1: Explanation.
- Feature 2: Explanation.
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