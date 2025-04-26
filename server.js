const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
require("dotenv").config();
const Razorpay = require('razorpay');

const app = express();
app.use(cors({
  origin: ["https://www.falconai.space", "http://localhost:5173","https://adepu-sanjay.vercel.app"],
  methods: ["GET", "POST"]
}));
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




// Contact form API endpoint
app.post("/api/contact", async (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ success: false, error: "All fields are required" });
    }

    try {
        // Nodemailer transporter with Gmail credentials
        const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "adepusanjay444@gmail.com",
        pass: "lrnesuqvssiognej", // Use the generated App Password here
    },
});

        // Email options (sent to your email)
        const mailOptions = {
            from: email, // Customer's email
            to: "adepusanjay444@gmail.com", // Your email (receiving messages)
            subject: "New Contact Form Submission",
            text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`,
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.json({ success: true, message: "Message sent successfully!" });
    } catch (error) {
        console.error("Error sending email:", error);
        res.status(500).json({ success: false, error: "Failed to send message" });
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

      // Background
      if (slide.theme?.startsWith("http")) {
        slidePpt.background = { path: slide.theme };
      } else {
        slidePpt.background = { color: slide.theme || "#FFFFFF" };
      }

      // Title
      slidePpt.addText(slide.title, {
        x: 0.5,
        y: 0.3,
        w: "90%",
        fontSize: 26,
        bold: true,
        color: slide.titleColor || "#D63384",
        align: "left",
        fontFace: "Arial Black",
      });

      // Separate bullets and code
      let bulletPoints = [];
      let codeBlocks = [];

      slide.content.forEach((point) => {
        if (point.trim().startsWith("Code  :")) {
          codeBlocks.push(point.replace("Code  :", "").trim());
        } else {
          bulletPoints.push(point.trim());
        }
      });

      const hasImage = !!slide.image;
      const margin = 0.5;
      const slideWidth = 10;
      const slideHeight = 5.62;
      const imageWidth = 3;
      const textAreaWidth = hasImage ? slideWidth - imageWidth - margin * 3 : 9;

      let currentY = 1.3;

      // Bullet Points
      if (bulletPoints.length > 0) {
        slidePpt.addText(
          bulletPoints.map((bp) => `• ${bp}`).join("\n"),
          {
            x: margin,
            y: currentY,
            w: textAreaWidth,
            h: 3,
            fontSize: 20,
            color: slide.contentColor || "#000000",
            fontFace: "Arial",
            align: "left",
            lineSpacing: 28,
          }
        );
        currentY += 3.2;
      }

      // Code Blocks (shifted right, top adjusted)
      if (codeBlocks.length > 0) {
        codeBlocks.forEach((code, idx) => {
          slidePpt.addText(code, {
            x: margin + 0.5, // Move right by 0.5
            y: currentY + idx * 1.5, // Small gap between multiple code blocks
            w: 8, // Limited width (not full width)
            h: 1.5,
            fontFace: "Courier New",
            fontSize: 16,
            color: "#FF5722",
            align: "left",
            fill: { color: "F1F1F1" }, // Light grey background
            margin: 0.2,
            valign: "top", // Text starts from top
          });
        });
      }

      // Optional Image
      if (hasImage) {
        slidePpt.addImage({
          path: slide.image,
          x: slideWidth - imageWidth,
          y: 0,
          w: imageWidth,
          h: slideHeight,
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
            const lines = section.split("\n").slice(1).map(line => line.trim());
            const content = [];

            let isCodeBlock = false;
            let codeBuffer = "";

            lines.forEach(line => {
                // Check for the start and end of code blocks
                if (line.startsWith("```")) {
                    if (!isCodeBlock) {
                        isCodeBlock = true;
                        codeBuffer = "";  // Start capturing code
                    } else {
                        // End of code block, add the code in the desired format without language hint
                        content.push(`Code  : \`\`\`\n${codeBuffer.trim()}\n\`\`\``);
                        codeBuffer = "";
                        isCodeBlock = false;
                    }
                } else if (isCodeBlock) {
                    // Add code lines inside the buffer while inside a code block
                    codeBuffer += line + "\n";
                } else if (line) {
                    // Regular content line, add with '- '
                    content.push(`- ${line}`);
                }
            });

            // Wrap title with asterisks (if required)
            slides.push({ 
                title: `${title}**`, 
                content: content
            });
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

    const isCodingTopic = ["Java", "Python", "JavaScript", "C++", "C#", "React", "Node.js","PHP"].some(lang =>
        topic.toLowerCase().includes(lang.toLowerCase())
    );

    let prompt;
    if (isCodingTopic) {
        prompt = `
Generate a PowerPoint presentation on "${topic}" with exactly ${slidesCount} slides.

Slide Structure:

1. Slide Title: Format as "Slide X: Title".
2. Explanation: Use clear, structured bullet points (max 3 per slide).
3. Code Snippets: Include only one **small** example per slide, not exceeding 4 lines.

Example:

Slide 2: Hello World Example

- Basic syntax of ${topic}.
- How to print output.
- Entry point of the program.

\`\`\`${topic.toLowerCase()} program
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
2. Content: Provide **exactly 4 to 5 
bullet points** explaining key concepts in simple terms. Every slide must have at least 4 points.
do not exceed 5 bullet points.
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


// ✅ AI-Powered Search using Google Gemini
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
            "who created you"
        ];

        if (identityQuestions.some(q => lowerQuery.includes(q))) {
            return res.json({
                query,
                response: "I am a large model of Falcon, developed by Adepu Sanjay."
            });
        }

        const response = await axios.post(
            GEMINI_API_URL,
            { contents: [{ parts: [{ text: query }] }] },
            {
                headers: { "Content-Type": "application/json" },
                params: { key: GOOGLE_GEMINI_API_KEY }
            }
        );

        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No relevant information found.";
        res.json({ query, response: aiResponse });

    } catch (error) {
        console.error("AI Search Error:", error.message);
        res.status(500).json({ error: "Failed to fetch search results" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
