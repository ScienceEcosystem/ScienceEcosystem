import { promises as fs } from "fs";
import path from "path";

// Generate sitemap.xml from all .html files in the repo root.
async function main() {
  const root = process.cwd();
  const domain = "https://scienceecosystem.org/";
  const today = new Date().toISOString().slice(0, 10);

  const entries = await fs.readdir(root, { withFileTypes: true });
  const pages = entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  // Map files to URLs (index.html becomes site root).
  const urls = pages.map((file) => {
    const loc = file === "index.html" ? domain : domain + file;
    return { loc, lastmod: today, priority: file === "index.html" ? "1.0" : undefined };
  });

  const xmlBody = urls
    .map((u) => {
      const priority = u.priority ? `<priority>${u.priority}</priority>` : "";
      return `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod>${priority}</url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlBody}\n</urlset>\n`;

  await fs.writeFile(path.join(root, "sitemap.xml"), xml, "utf8");
  console.log(`sitemap.xml updated with ${urls.length} URLs (${today}).`);
}

main().catch((err) => {
  console.error("Failed to generate sitemap:", err);
  process.exit(1);
});
