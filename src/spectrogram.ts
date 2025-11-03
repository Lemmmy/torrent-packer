import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { env } from "./env.ts";
import { findFiles } from "./file-utils.ts";

/**
 * Generate spectrograms for a single audio file
 */
async function generateSpectrogramsForFile(inputFile: string, outputDir: string): Promise<void> {
  const basename = path.basename(inputFile, path.extname(inputFile));

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  const fullPath = path.join(outputDir, `${basename}_full.png`);
  const zoomPath = path.join(outputDir, `${basename}_zoom.png`);

  // Generate full spectrogram
  // sox input.flac -n remix 1 spectrogram -x 3000 -y 513 -z 120 -w Kaiser -o output.png
  await new Promise<void>((resolve, reject) => {
    const fullProcess = spawn(
      env.SOX_PATH,
      [
        inputFile,
        "-n",
        "remix",
        "1",
        "spectrogram",
        "-x",
        "3000",
        "-y",
        "513",
        "-z",
        "120",
        "-w",
        "Kaiser",
        "-o",
        fullPath,
      ],
      { windowsHide: true },
    );

    let stderr = "";
    fullProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    fullProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Full spectrogram generation failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    fullProcess.on("error", reject);
  });

  // Generate zoom spectrogram
  // sox input.flac -n remix 1 spectrogram -x 500 -y 1025 -z 120 -w Kaiser -S 1:00 -d 0:02 -o output.png
  await new Promise<void>((resolve, reject) => {
    const zoomProcess = spawn(
      env.SOX_PATH,
      [
        inputFile,
        "-n",
        "remix",
        "1",
        "spectrogram",
        "-x",
        "500",
        "-y",
        "1025",
        "-z",
        "120",
        "-w",
        "Kaiser",
        "-S",
        "1:00",
        "-d",
        "0:02",
        "-o",
        zoomPath,
      ],
      { windowsHide: true },
    );

    let stderr = "";
    zoomProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    zoomProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Zoom spectrogram generation failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    zoomProcess.on("error", reject);
  });
}

/**
 * Generate spectrograms for all audio files in a release
 * Returns a promise that resolves when all spectrograms are generated
 */
export async function generateSpectrograms(releaseDir: string): Promise<PQueue> {
  const queue = new PQueue({ concurrency: env.CONCURRENCY_LIMIT });

  // Find all FLAC files
  const flacFiles = await findFiles(releaseDir, /\.flac$/i);

  if (flacFiles.length === 0) {
    return queue;
  }

  console.log(chalkTemplate`  {blue →} Generating spectrograms for ${flacFiles.length} files in background...`);

  // Get the release directory name
  const releaseName = path.basename(releaseDir);
  const spectrogramsBaseDir = path.join(env.SPECTROGRAMS_DIR, releaseName);

  // Queue all spectrogram generation tasks
  for (const flacFile of flacFiles) {
    queue.add(async () => {
      try {
        // Get relative path from release dir to maintain directory structure
        const relativePath = path.relative(releaseDir, flacFile);
        const relativeDir = path.dirname(relativePath);

        // Create output directory maintaining structure
        const outputDir = path.join(spectrogramsBaseDir, relativeDir);

        await generateSpectrogramsForFile(flacFile, outputDir);
      } catch (error) {
        console.warn(
          chalkTemplate`    {yellow ⚠} Failed to generate spectrogram for ${path.basename(flacFile)}: ${error}`,
        );
      }
    });
  }

  return queue;
}
