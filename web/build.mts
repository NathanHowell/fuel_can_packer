#!/usr/bin/env node
import {
  build,
  context,
  type BuildContext,
  type BuildOptions,
  type OnLoadResult,
  type PartialMessage,
  type Plugin,
  type PluginBuild,
} from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import pngToIco from "png-to-ico";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

async function averageBackgroundColor(imagePath: string): Promise<RgbaColor> {
  const { data } = await sharp(imagePath)
    .resize(1, 1, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [r = 242, g = 242, b = 242] = data;
  return { r, g, b, alpha: 1 };
}

const isWatch: boolean = process.argv.includes("--watch");
const isProd: boolean =
  process.env["NODE_ENV"] === "production" || (!isWatch && process.argv.includes("--prod"));
const minify: boolean = isProd || !isWatch;

function createPostcssPlugin(): Plugin {
  return {
    name: "postcss-tailwind",
    setup(buildCtx: PluginBuild): void {
      buildCtx.onLoad({ filter: /\.css$/ }, async (args): Promise<OnLoadResult> => {
        const source = await readFile(args.path, "utf8");
        const result = await postcss([
          tailwindcss({
            optimize: isProd ? { minify: false } : false,
          }),
        ]).process(source, {
          from: args.path,
          to: args.path,
        });

        return {
          contents: result.css,
          loader: "css",
          resolveDir: dirname(args.path),
          warnings: result.warnings().map((warning): PartialMessage => {
            const sourceFile: string = warning.node.source?.input.file ?? args.path;
            return {
              text: warning.text,
              location: {
                file: sourceFile,
                line: warning.line,
                column: warning.column,
              },
            };
          }),
        };
      });
    },
  };
}

function createSocialCardPlugin(): Plugin {
  const sourceFilename = "social-card.png";
  const outputs: readonly {
    filename: string;
    format: "jpeg" | "webp";
    quality: number;
  }[] = [
    { filename: "social-card.jpg", format: "jpeg", quality: 84 },
    { filename: "social-card.webp", format: "webp", quality: 82 },
  ];

  return {
    name: "social-card",
    setup(buildCtx: PluginBuild): void {
      buildCtx.onStart(async (): Promise<void> => {
        const cwd = buildCtx.initialOptions.absWorkingDir ?? process.cwd();
        const sourcePath = join(cwd, sourceFilename);
        const outputDir = "dist";
        await mkdir(join(cwd, outputDir), { recursive: true });
        const background = await averageBackgroundColor(sourcePath);
        const resized = sharp(sourcePath).resize({
          width: 1200,
          height: 630,
          fit: "contain",
          position: "center",
          background,
          withoutEnlargement: true,
        });

        await Promise.all(
          outputs.map(async ({ filename, format, quality }) => {
            const outputPath = join(cwd, outputDir, filename);
            const pipeline = resized.clone();
            if (format === "jpeg") {
              await pipeline
                .jpeg({
                  quality,
                  progressive: true,
                  chromaSubsampling: "4:4:4",
                })
                .toFile(outputPath);
              return;
            }
            await pipeline
              .webp({
                quality,
                effort: 5,
              })
              .toFile(outputPath);
          }),
        );

        const filenames = outputs.map(({ filename }): string => filename).join(", ");
        console.log(`Generated social card (1200x630) in ${outputDir}: ${filenames}`);
      });
    },
  };
}

function createFaviconPlugin(): Plugin {
  const sourceFilename = "favicon.png";
  const pngOutputs: readonly { size: number; filename: string }[] = [
    { size: 16, filename: "favicon-16x16.png" },
    { size: 32, filename: "favicon-32x32.png" },
    { size: 180, filename: "apple-touch-icon.png" },
    { size: 192, filename: "favicon-192x192.png" },
    { size: 512, filename: "favicon-512x512.png" },
  ];
  const icoSizes: readonly number[] = [16, 32, 48];
  const outputDir = "dist";

  return {
    name: "favicons",
    setup(buildCtx: PluginBuild): void {
      buildCtx.onStart(async (): Promise<void> => {
        const cwd = buildCtx.initialOptions.absWorkingDir ?? process.cwd();
        const sourcePath = join(cwd, sourceFilename);
        await mkdir(join(cwd, outputDir), { recursive: true });
        const base = sharp(sourcePath);

        await Promise.all(
          pngOutputs.map(async ({ size, filename }) => {
            const outputPath = join(cwd, outputDir, filename);
            await base
              .clone()
              .resize(size, size, { fit: "cover", withoutEnlargement: true })
              .toFile(outputPath);
          }),
        );

        const icoPath = join(cwd, outputDir, "favicon.ico");
        const icoBuffers = await Promise.all(
          icoSizes.map(async (size) =>
            base
              .clone()
              .resize(size, size, { fit: "cover", withoutEnlargement: true })
              .png()
              .toBuffer(),
          ),
        );
        const icoFile = await pngToIco(icoBuffers);
        await writeFile(icoPath, icoFile);

        const pngNames = pngOutputs.map(({ filename }): string => filename).join(", ");
        console.log(`Generated favicons in ${outputDir}: ${pngNames}, favicon.ico`);
      });
    },
  };
}

const buildOptions: BuildOptions = {
  entryPoints: ["./app.ts", "./solver-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2024",
  outdir: "dist",
  sourcemap: true,
  minify,
  entryNames: "[name]",
  // eslint-disable-next-line @typescript-eslint/naming-convention
  loader: { ".css": "css" },
  plugins: [createPostcssPlugin(), createSocialCardPlugin(), createFaviconPlugin()],
  logLevel: "info",
};

async function runBuild(): Promise<void> {
  if (isWatch) {
    const ctx: BuildContext = await context(buildOptions);
    await ctx.watch();
    console.log("Watching for changes (esbuild + Tailwind)...");
    return;
  }

  await build(buildOptions);
  console.log("Bundle complete.");
}

runBuild().catch((err: unknown): void => {
  console.error(err);
  process.exit(1);
});
