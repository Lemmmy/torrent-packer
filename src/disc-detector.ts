import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DiscInfo } from "./types.ts";

/**
 * Check if a directory contains a BDMV directory (recursively)
 */
async function containsBDMV(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name === "BDMV" && entry.isDirectory()) {
        return true;
      }
      
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        if (await containsBDMV(fullPath)) {
          return true;
        }
      }
    }
  } catch (error) {
    // Ignore errors (e.g., permission denied)
  }
  
  return false;
}

/**
 * Check if a directory contains a VIDEO_TS directory (recursively)
 */
async function containsVIDEO_TS(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name === "VIDEO_TS" && entry.isDirectory()) {
        return true;
      }
      
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        if (await containsVIDEO_TS(fullPath)) {
          return true;
        }
      }
    }
  } catch (error) {
    // Ignore errors (e.g., permission denied)
  }
  
  return false;
}

/**
 * Detect disc type based on directory name and contents
 */
async function detectDiscType(dir: string, name: string): Promise<"cd" | "bd" | "dvd" | "photobook"> {
  // Check if it's a photobook
  if (name.toLowerCase().startsWith("photobook")) {
    return "photobook";
  }
  
  // Check for BD or DVD content
  const hasBDMV = await containsBDMV(dir);
  if (hasBDMV) {
    return "bd";
  }
  
  const hasVIDEO_TS = await containsVIDEO_TS(dir);
  if (hasVIDEO_TS) {
    return "dvd";
  }
  
  // Default to CD
  return "cd";
}

/**
 * Detect all discs in a release directory
 * @param releaseDir - The release directory path
 * @param forceType - Optional: force the release to be treated as a specific type
 */
export async function detectDiscs(
  releaseDir: string,
  forceType?: "cd" | "bd" | "dvd"
): Promise<DiscInfo[]> {
  const discs: DiscInfo[] = [];
  
  try {
    const entries = await fs.readdir(releaseDir, { withFileTypes: true });
    
    // Check if there are any "Disc N" folders
    const hasDiscFolders = entries.some(
      (entry) => entry.isDirectory() && entry.name.match(/^Disc\s+\d+/i)
    );
    
    if (!hasDiscFolders && forceType) {
      // No disc folders, but force type specified - treat entire release as single disc
      discs.push({
        path: releaseDir,
        name: path.basename(releaseDir),
        type: forceType,
      });
      return discs;
    }
    
    if (!hasDiscFolders) {
      // No disc folders and no force type - check if root contains BD/DVD content
      const hasBDMV = await containsBDMV(releaseDir);
      const hasVIDEO_TS = await containsVIDEO_TS(releaseDir);
      
      if (hasBDMV || hasVIDEO_TS) {
        // Root contains BD/DVD content - treat as single disc
        discs.push({
          path: releaseDir,
          name: path.basename(releaseDir),
          type: hasBDMV ? "bd" : "dvd",
        });
        return discs;
      }
      
      // No disc folders, no BD/DVD content - treat as CD release
      discs.push({
        path: releaseDir,
        name: path.basename(releaseDir),
        type: "cd",
      });
      return discs;
    }
    
    // Has disc folders - detect each one
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      
      const name = entry.name;
      
      // Check if it's a disc directory (starts with "Disc " or is "Photobook")
      if (name.match(/^Disc\s+\d+/i) || name.toLowerCase().startsWith("photobook")) {
        const fullPath = path.join(releaseDir, name);
        const type = await detectDiscType(fullPath, name);
        
        discs.push({
          path: fullPath,
          name,
          type,
        });
      }
    }
  } catch (error) {
    console.error(`Error detecting discs in ${releaseDir}:`, error);
  }
  
  return discs;
}

/**
 * Check if a release has any Blu-ray discs
 */
export function hasBlurayDiscs(discs: DiscInfo[]): boolean {
  return discs.some((disc) => disc.type === "bd");
}

/**
 * Check if a release has any DVD discs
 */
export function hasDVDDiscs(discs: DiscInfo[]): boolean {
  return discs.some((disc) => disc.type === "dvd");
}

/**
 * Check if a release has any photobooks
 */
export function hasPhotobooks(discs: DiscInfo[]): boolean {
  return discs.some((disc) => disc.type === "photobook");
}
