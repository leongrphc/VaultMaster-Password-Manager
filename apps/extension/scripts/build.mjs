import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

if (!existsSync(srcDir)) {
  throw new Error("Source directory not found.");
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });

console.log("Extension build complete:", distDir);
