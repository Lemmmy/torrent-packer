import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Recursively find all files matching a pattern
 */
export async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Recursively copy directory structure, optionally filtering files
 */
export async function copyDirectoryStructure(
  srcDir: string,
  destDir: string,
  fileFilter?: (filename: string) => boolean,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });

  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryStructure(srcPath, destPath, fileFilter);
    } else if (entry.isFile()) {
      if (!fileFilter || fileFilter(entry.name)) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

/**
 * Get all files in a directory recursively
 */
export async function getAllFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Check if a path matches any of the given patterns
 */
export function matchesPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const pattern of patterns) {
    // Simple pattern matching - checks if the path contains the pattern
    if (normalizedPath.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Delete a file if it exists
 */
export async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
