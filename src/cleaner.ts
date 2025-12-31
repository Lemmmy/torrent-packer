import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { env } from "./env.ts";
import { findFiles } from "./file-utils.ts";

const execFileAsync = promisify(execFile);

/**
 * Process a single image in a directory
 */
async function processImageInDirectory(dir: string, originalImage: string): Promise<void> {
  const coverPath = path.join(dir, "cover.jpg");

  // Skip if already named cover.jpg
  if (path.basename(originalImage).toLowerCase() === "cover.jpg") {
    // Still resize it
    await sharp(originalImage)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(coverPath + ".tmp");

    await fs.rename(coverPath + ".tmp", coverPath);
    console.log(chalkTemplate`  {green ✓} Resized cover art: ${path.relative(dir, coverPath)}`);
    return;
  }

  // Resize and save as cover.jpg
  await sharp(originalImage)
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toFile(coverPath);

  // Remove original
  await fs.unlink(originalImage);

  console.log(chalkTemplate`  {green ✓} Processed cover art: ${path.basename(originalImage)} → cover.jpg`);
}

/**
 * Process cover art in a release directory:
 * - If there's only one image file in the base directory, resize it to max 512x512 and rename to cover.jpg
 * - Also process images in Disc subdirectories that contain FLAC files
 * - Remove the original image files
 */
export async function processCoverArt(releaseDir: string): Promise<void> {
  const imageExtensions = /\.(jpg|jpeg|png|gif|bmp|webp)$/i;

  // Find all image files in the base directory (not subdirectories)
  const entries = await fs.readdir(releaseDir, { withFileTypes: true });
  const imageFiles = entries
    .filter((entry) => entry.isFile() && imageExtensions.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));

  // Process base directory image if there's exactly one
  if (imageFiles.length === 1) {
    await processImageInDirectory(releaseDir, imageFiles[0]);
  }

  // Process Disc subdirectories
  const discDirs = entries.filter((entry) => entry.isDirectory() && entry.name.match(/^Disc\s+\d+/i));

  for (const discDir of discDirs) {
    const discPath = path.join(releaseDir, discDir.name);
    const discEntries = await fs.readdir(discPath, { withFileTypes: true });

    // Check if this disc contains FLAC files
    const hasFlacFiles = discEntries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".flac"));

    if (!hasFlacFiles) {
      continue;
    }

    // Find images in this disc directory
    const discImageFiles = discEntries
      .filter((entry) => entry.isFile() && imageExtensions.test(entry.name))
      .map((entry) => path.join(discPath, entry.name));

    // Process if there's exactly one image
    if (discImageFiles.length === 1) {
      await processImageInDirectory(discPath, discImageFiles[0]);
    }
  }
}

/**
 * Remove embedded covers and add padding to FLAC files using metaflac
 */
export async function stripFlacCovers(flacFiles: string[], queue: PQueue): Promise<void> {
  await Promise.all(
    flacFiles.map((flacFile) =>
      queue.add(async () => {
        // Step 1: Remove pictures and padding
        await execFileAsync(
          env.METAFLAC_PATH,
          ["--remove", "--block-type=PICTURE,PADDING", "--dont-use-padding", flacFile],
          {
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        // Step 2: Add back a small amount of padding
        await execFileAsync(env.METAFLAC_PATH, ["--add-padding=4096", flacFile], {
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        });
      }),
    ),
  );
}

/**
 * Delete all .m3u8 files in a directory recursively
 */
export async function deleteM3U8Files(releaseDir: string): Promise<void> {
  const m3u8Files = await findFiles(releaseDir, /\.m3u8?$/i);

  for (const file of m3u8Files) {
    await fs.unlink(file);
    console.log(chalkTemplate`  {gray Deleted m3u8 file: ${path.basename(file)}}`);
  }
}

/**
 * Rename .cue files to match .log files if there's exactly one of each
 */
export async function renameCueFiles(releaseDir: string): Promise<void> {
  async function processDirectory(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const logFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
      .map((entry) => path.join(dir, entry.name));

    const cueFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".cue"))
      .map((entry) => path.join(dir, entry.name));

    // If exactly one .log and one .cue, rename the .cue to match the .log
    if (logFiles.length === 1 && cueFiles.length === 1) {
      const logBasename = path.basename(logFiles[0], ".log");
      const cueBasename = path.basename(cueFiles[0], ".cue");

      if (logBasename !== cueBasename) {
        const newCuePath = path.join(dir, logBasename + ".cue");
        await fs.rename(cueFiles[0], newCuePath);
        console.log(chalkTemplate`  {cyan ℹ} Renamed cue file: ${cueBasename}.cue → ${logBasename}.cue`);
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await processDirectory(path.join(dir, entry.name));
      }
    }
  }

  await processDirectory(releaseDir);
}
