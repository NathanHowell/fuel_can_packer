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
  const staticFiles = ["index.html", "coi-serviceworker.js"];
  for (const file of staticFiles) {
    const dest = join(outputDir, file);
    await copyFile(file, dest);
    console.log(`Copied ${file}`);
  }
  
  // Copy dist directory
  const distSrc = "dist";
  const distDest = join(outputDir, "dist");
  await copyRecursive(distSrc, distDest);
  console.log("Copied dist/");
  
  console.log(`\nBuild complete! Static site ready in ${outputDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
