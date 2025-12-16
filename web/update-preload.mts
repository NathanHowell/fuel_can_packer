#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface MetaOutput {
  bytes: number;
  inputs: Record<string, { bytesInOutput: number }>;
  imports: Array<{ path: string; kind: string; external?: boolean }>;
  exports: string[];
  entryPoint?: string;
  cssBundle?: string;
}

interface MetaJson {
  inputs: Record<string, { bytes: number; imports: Array<{ path: string }> }>;
  outputs: Record<string, MetaOutput>;
}

const metaPath = join(process.cwd(), "dist", "meta.json");
const indexPath = join(process.cwd(), "index.html");

async function main(): Promise<void> {
  const metaRaw = await readFile(metaPath, "utf8");
  const meta: MetaJson = JSON.parse(metaRaw);
  const chunk = Object.keys(meta.outputs || {}).find((k) => k.startsWith("dist/chunks/") && k.endsWith(".js"));

  const html = await readFile(indexPath, "utf8");

  if (!chunk) {
    // No chunks found - remove any existing modulepreload link if present
    if (html.includes('rel="modulepreload"')) {
      const replaced = html.replace(/\s*<link rel="modulepreload" href="[^"]*">\n?/, '');
      await writeFile(indexPath, replaced, "utf8");
    }
    return;
  }

  const href = `./${chunk}`;
  const linkTag = `<link rel="modulepreload" href="${href}">`;
  if (html.includes(linkTag)) {
    return;
  }
  const replaced = html.includes('rel="modulepreload"')
    ? html.replace(/<link rel="modulepreload" href="[^"]*">/, linkTag)
    : html.replace("</head>", `  ${linkTag}\n</head>`);
  await writeFile(indexPath, replaced, "utf8");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
