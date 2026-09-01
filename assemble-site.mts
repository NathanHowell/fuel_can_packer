#!/usr/bin/env node
import { readdir, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const outputDir = "_site";

async function exists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

const SITE_URL = "https://fuel.for.alienz.org";

interface SitemapEntry {
  readonly path: string;
  readonly sources: readonly string[];
  readonly priority: string;
}

const SITEMAP_ENTRIES: readonly SitemapEntry[] = [
  { path: "/", sources: ["index.html", "app.ts", "solver.ts", "styles.css"], priority: "1.0" },
  { path: "/algorithm.html", sources: ["algorithm.html", "styles.css"], priority: "0.6" },
];

function lastCommitDate(files: readonly string[]): string {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", ...files], {
      encoding: "utf8",
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) {
      return out;
    }
  } catch {
    // fall through to today's date when git metadata is unavailable
  }
  return new Date().toISOString().slice(0, 10);
}

function generateSitemap(): string {
  const urls = SITEMAP_ENTRIES.map(({ path, sources, priority }) => [
    "  <url>",
    `    <loc>${SITE_URL}${path}</loc>`,
    `    <lastmod>${lastCommitDate(sources)}</lastmod>`,
    "    <changefreq>monthly</changefreq>",
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  // Clean output directory
  if (await exists(outputDir)) {
    await rm(outputDir, { recursive: true });
  }
  await mkdir(outputDir, { recursive: true });

  // Copy static files from current directory
  const staticFiles: readonly string[] = [
    "index.html",
    "algorithm.html",
    "manifest.webmanifest",
    "robots.txt",
    "_headers",
  ];
  for (const file of staticFiles) {
    try {
      const dest = join(outputDir, file);
      await copyFile(file, dest);
      console.log(`Copied ${file}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Failed to copy ${file}: ${message}`);
      process.exit(1);
    }
  }

  await writeFile(join(outputDir, "sitemap.xml"), generateSitemap());
  console.log("Generated sitemap.xml");

  // Copy dist directory
  const distSrc = "dist";
  const distDest = join(outputDir, "dist");
  if (!(await exists(distSrc))) {
    console.error("Error: dist directory not found. Run 'npm run build' first.");
    process.exit(1);
  }
  await copyRecursive(distSrc, distDest);
  console.log("Copied dist/");

  // Promote key assets to the site root for legacy/favicon consumers
  const rootAssets: readonly string[] = ["favicon.ico", "apple-touch-icon.png"];
  for (const file of rootAssets) {
    const src = join(distDest, file);
    const dest = join(outputDir, file);
    try {
      await copyFile(src, dest);
      console.log(`Copied ${file} to site root`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Failed to copy ${file} to site root: ${message}`);
      process.exit(1);
    }
  }

  console.log(`\nBuild complete! Static site ready in ${outputDir}/`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
