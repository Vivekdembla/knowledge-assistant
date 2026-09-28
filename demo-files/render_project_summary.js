const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(__dirname, "Knowledge_Assistant_Project_Summary.html");
const outputPath = path.join(__dirname, "Knowledge_Assistant_Project_Summary.pdf");
const html = fs.readFileSync(inputPath, "utf8");

function plainText(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-");
}

const blocks = [];
const callout = html.match(/<div class="callout">([\s\S]*?)<\/div>/i);
const body = html.replace(/<style[\s\S]*?<\/style>/i, "");
const elements = [...body.matchAll(/<(h1|h2|p|li|tr)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|p|li|tr)>/gi)];
for (const match of elements) {
  const tag = match[1].toLowerCase();
  const value = plainText(match[2]);
  if (!value) continue;
  if (tag === "tr") {
    const cells = [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => plainText(cell[1]));
    blocks.push({ kind: "body", text: cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join(" ")}` : value });
  } else if (tag === "li") {
    blocks.push({ kind: "bullet", text: value });
  } else {
    blocks.push({ kind: tag === "h1" ? "title" : tag === "h2" ? "heading" : "body", text: value });
  }
}
if (callout) {
  const calloutText = plainText(callout[1]);
  const solutionIndex = blocks.findIndex((block) => block.text === "The solution");
  const insertAt = blocks.findIndex((block, index) => index > solutionIndex && block.kind === "heading");
  blocks.splice(insertAt < 0 ? blocks.length : insertAt, 0, { kind: "callout", text: calloutText });
}

const pageWidth = 612;
const pageHeight = 792;
const left = 56;
const bottom = 54;
const pages = [];
let commands = [];
let y = pageHeight - 58;
let pageNumber = 1;

function startPage() {
  commands = [];
  y = pageHeight - 58;
  commands.push("0.13 0.39 0.31 rg");
  commands.push("BT /F2 9 Tf 56 753 Td (KNOWLEDGE ASSISTANT  /  PROJECT CASE STUDY) Tj ET");
  commands.push("0 0 0 rg");
}
function finishPage() {
  commands.push("0.82 0.87 0.84 RG 56 43 m 556 43 l S");
  commands.push(`0.35 0.4 0.37 rg BT /F1 8 Tf 56 29 Td (Project overview - sample demo document) Tj ET`);
  commands.push(`BT /F1 8 Tf 535 29 Td (${pageNumber}) Tj ET`);
  pages.push(commands.join("\n"));
  pageNumber += 1;
}
function escapePdf(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function draw(text, font, size, color = "0 0 0") {
  commands.push(`${color} rg`);
  commands.push(`BT /${font} ${size} Tf ${left} ${y} Td (${escapePdf(text)}) Tj ET`);
  y -= size * 1.45;
}

startPage();
for (const block of blocks) {
  if (block.kind === "title") {
    y -= 9;
    draw(block.text, "F2", 25, "0.09 0.24 0.2");
    continue;
  }
  if (block.kind === "heading") {
    y -= 8;
    if (y < bottom + 48) {
      finishPage();
      startPage();
    }
    draw(block.text, "F2", 14, "0.13 0.39 0.31");
    continue;
  }
  const callout = block.kind === "callout";
  const bullet = block.kind === "bullet";
  const prefix = bullet ? "- " : "";
  const lines = wrap(prefix + block.text, callout ? 82 : 91);
  const lineHeight = callout ? 15 : 14;
  if (y - lines.length * lineHeight < bottom + 18) {
    finishPage();
    startPage();
  }
  if (callout) {
    commands.push(`0.93 0.96 0.94 rg ${left - 8} ${y - lines.length * lineHeight + 3} 508 ${lines.length * lineHeight + 16} re f`);
    commands.push(`0.13 0.39 0.31 RG 48 ${y - lines.length * lineHeight + 3} m 48 ${y + 13} l S`);
    y -= 3;
  }
  for (const line of lines) {
    draw(line, "F1", 10, callout ? "0.09 0.24 0.2" : "0.13 0.16 0.14");
    y -= lineHeight - 14.5;
  }
  y -= callout ? 7 : 3;
}
finishPage();

const objects = [];
function addObject(value) {
  objects.push(Buffer.from(value, "ascii"));
  return objects.length;
}
const catalogId = addObject("");
const pagesId = addObject("");
const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
const pageIds = [];
for (const page of pages) {
  const stream = Buffer.from(page, "ascii");
  const contentId = addObject(Buffer.concat([
    Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
    stream,
    Buffer.from("\nendstream", "ascii"),
  ]));
  const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  pageIds.push(pageId);
}
objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "ascii");
objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "ascii");

const chunks = [Buffer.from("%PDF-1.4\n% Knowledge Assistant project summary\n", "ascii")];
const offsets = [0];
let byteOffset = chunks[0].length;
for (let index = 0; index < objects.length; index += 1) {
  offsets.push(byteOffset);
  const objectChunk = Buffer.concat([
    Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
    objects[index],
    Buffer.from("\nendobj\n", "ascii"),
  ]);
  chunks.push(objectChunk);
  byteOffset += objectChunk.length;
}
const xrefOffset = byteOffset;
let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let index = 1; index < offsets.length; index += 1) {
  xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
}
chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
fs.writeFileSync(outputPath, Buffer.concat(chunks));
console.log(`Created ${outputPath} (${pages.length} pages)`);
