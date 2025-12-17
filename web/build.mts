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
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  plugins: [createPostcssPlugin()],
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
