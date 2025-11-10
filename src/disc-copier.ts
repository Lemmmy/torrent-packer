import * as fs from "node:fs/promises";
import * as path from "node:path";
import { shouldGloballyFilter } from "./file-utils.ts";
import type { DiscInfo } from "./types.ts";

/**
 * Copy a release directory, excluding specific disc types
 */
export async function copyReleaseExcludingDiscs(
  srcDir: string,
  destDir: string,
  excludeDiscTypes: ("cd" | "bd" | "dvd" | "photobook")[],
  discs: DiscInfo[],
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  // Get set of disc paths to exclude
  const excludedPaths = new Set(
    discs
      .filter((disc) => excludeDiscTypes.includes(disc.type))
      .map((disc) => disc.path)
  );

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    // Apply global filters
    if (shouldGloballyFilter(srcPath)) {
      continue;
    }

    // Skip excluded discs
    if (excludedPaths.has(srcPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyReleaseExcludingDiscs(srcPath, destPath, excludeDiscTypes, discs);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copy only specific disc types from a release
 */
export async function copySpecificDiscs(
  srcDir: string,
  destDir: string,
  includeDiscTypes: ("cd" | "bd" | "dvd" | "photobook")[],
  discs: DiscInfo[],
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  // Get discs to include
  const includedDiscs = discs.filter((disc) => includeDiscTypes.includes(disc.type));

  for (const disc of includedDiscs) {
    const destPath = path.join(destDir, disc.name);
    await copyDirectoryRecursive(disc.path, destPath);
  }
}

/**
 * Recursively copy a directory
 */
async function copyDirectoryRecursive(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    // Apply global filters
    if (shouldGloballyFilter(srcPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
