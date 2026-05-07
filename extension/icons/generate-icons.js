// Run once with: node generate-icons.js
// Generates simple placeholder PNG icons for the extension.
// Replace with real icons when ready.
const { createCanvas } = require("canvas"); // npm i canvas
const fs = require("fs");

const sizes = [16, 32, 48, 128];
const BG = "#2e7f9f";   // SE brand teal
const FG = "#ffffff";

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Rounded square background
  const r = size * 0.2;
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Letter "S"
  ctx.fillStyle = FG;
  ctx.font = `bold ${Math.round(size * 0.6)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("S", size / 2, size / 2 + size * 0.03);

  fs.writeFileSync(`icon${size}.png`, canvas.toBuffer("image/png"));
  console.log(`icon${size}.png written`);
}
