#!/usr/bin/env node
import { readdir, mkdir, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";

const outputDir = "_site";

async function exists(path) {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function copyRecursive(src, dest) {
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

async function main() {
  // Clean output directory
  if (await exists(outputDir)) {
    await rm(outputDir, { recursive: true });
  }
  await mkdir(outputDir, { recursive: true });
  
  // Copy static files from current directory
  const staticFiles = ["index.html", "coi-serviceworker.js", "_headers"];
  for (const file of staticFiles) {
    try {
      const dest = join(outputDir, file);
      await copyFile(file, dest);
      console.log(`Copied ${file}`);
    } catch (err) {
      console.error(`Warning: Failed to copy ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  
  // Copy dist directory
  const distSrc = "dist";
  const distDest = join(outputDir, "dist");
  if (!(await exists(distSrc))) {
    console.error("Error: dist directory not found. Run 'npm run build' first.");
    process.exit(1);
  }
  await copyRecursive(distSrc, distDest);
  console.log("Copied dist/");
  
  console.log(`\nBuild complete! Static site ready in ${outputDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
