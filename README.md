# falconAi-backend


const path = require("path");
const fs = require("fs");
const PptxGenJS = require("pptxgenjs");

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

      // Support image or color theme backgrounds
      if (slide.theme?.startsWith("http")) {
        slidePpt.background = { path: slide.theme };
      } else {
        slidePpt.background = { color: slide.theme || "#FFFFFF" };
      }

      slidePpt.addText(slide.title, {
        x: 0.5, y: 0.5, w: "80%",
        fontSize: 23, bold: true,
        color: slide.titleColor || "#D63384",
        align: "left", fontFace: "Arial Black"
      });

      let formattedContent = slide.content.flatMap(point => {
        if (point.includes(":")) {
          const [label, rest] = point.split(/:(.*)/);
          return [
            { text: `🔹 ${label.trim()}: `, options: { bold: true } },
            { text: `${rest.trim()}\n` }
          ];
        } else {
          return [{ text: `🔹 ${point}\n` }];
        }
      });

      if (slide.image) {
        const imageWidth = 3;
        const imageHeight = 5.62;
        const slideWidth = 10;
        const margin = 0.5;
        const textWidth = slideWidth - imageWidth - (margin * 2);

        slidePpt.addText(formattedContent, {
          x: margin,
          y: margin,
          w: textWidth,
          h: imageHeight - (margin * 1.8),
          fontSize: 15,
          color: slide.contentColor || "#333333",
          fontFace: "Arial",
          lineSpacing: 26,
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
