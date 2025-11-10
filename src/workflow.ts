import chalkTemplate from "chalk-template";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import PQueue from "p-queue";
import inquirer from "inquirer";
import { deleteM3U8Files, processCoverArt, renameCueFiles, stripFlacCovers } from "./cleaner.ts";
import { downsample24BitFlac } from "./downsample.ts";
import { validateTranscodedDurations } from "./duration-validator.ts";
import { env } from "./env.ts";
import { findFiles } from "./file-utils.ts";
import { parseReleaseDirectory } from "./release-parser.ts";
import { generateSpectrograms } from "./spectrogram.ts";
import { createTorrentsForRelease } from "./torrent-creator.ts";
import { transcodeToMP3 } from "./transcoder.ts";
import type { TrackerConfig, TrackersConfig } from "./types.ts";
import {
  checkForId3Tags,
  checkUnicodeNormalization,
  validateAudioFiles,
  validateFlacBitrate,
  validateFlacFiles,
  validateLogFiles,
} from "./validator.ts";
import { hasVerificationWarnings, resetVerificationWarnings } from "./warning-utils.ts";

export interface ProcessingResult {
  flac?: string;
  flac24?: string;
  mp3_320?: string;
  mp3_v0?: string;
  bluray?: string;
  dvd?: string;
  photobook?: string;
}

/**
 * Process a single release directory
 */
export async function processRelease(
  releaseDir: string,
  trackers: TrackerConfig[],
  skip320: boolean = false,
  noMove: boolean = false,
  forceType?: "cd" | "bd" | "dvd",
): Promise<ProcessingResult> {
  const queue = new PQueue({ concurrency: env.CONCURRENCY_LIMIT });
  const releaseInfo = await parseReleaseDirectory(releaseDir, forceType);

  console.log(chalkTemplate`\n{bold.cyan Processing:} ${releaseInfo.basename}`);

  // Step 1: Verify input
  console.log(chalkTemplate`{bold Step 1:} Verifying input...`);

  // Reset verification warning flag for this release
  resetVerificationWarnings();

  let flacDurations: Map<string, number> | undefined;
  if (releaseInfo.hasMP3) {
    // For MP3 releases, just validate audio files
    flacDurations = await validateAudioFiles(releaseDir, queue);
  } else {
    // For FLAC releases, run full validation
    await validateFlacFiles(releaseDir, queue);
    await checkForId3Tags(releaseDir, queue);
    await checkUnicodeNormalization(releaseDir, queue);
    flacDurations = await validateAudioFiles(releaseDir, queue);
    await validateFlacBitrate(releaseDir, queue);
  }

  await validateLogFiles(releaseDir, queue);

  // If any verification warnings were shown, prompt user to continue
  if (hasVerificationWarnings()) {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "continue",
        message: "Verification warnings detected. Continue processing this release?",
        default: false,
      },
    ]);

    if (!answer.continue) {
      console.log(chalkTemplate`{yellow Skipping release: ${releaseInfo.basename}}\n`);
      return {} as ProcessingResult;
    }
  }

  // Step 2: Clean input
  console.log(chalkTemplate`{bold Step 2:} Cleaning input...`);

  await processCoverArt(releaseDir);

  if (!releaseInfo.hasMP3) {
    const flacFiles = await findFiles(releaseDir, /\.flac$/i);
    await stripFlacCovers(flacFiles, queue);
  }

  await deleteM3U8Files(releaseDir);
  await renameCueFiles(releaseDir);

  // Start generating spectrograms in the background (after cleaning so files aren't modified during generation)
  let spectrogramQueue: PQueue | undefined;
  if (!releaseInfo.hasMP3) {
    spectrogramQueue = await generateSpectrograms(releaseDir);
  }

  const result: ProcessingResult = {};

  // Step 3: Transcode input
  console.log(chalkTemplate`{bold Step 3:} Transcoding...`);

  if (releaseInfo.hasMP3) {
    console.log(chalkTemplate`  {cyan ℹ} Release contains MP3s, skipping transcoding`);
    result.mp3_320 = releaseDir;
  } else if (releaseInfo.is24Bit) {
    console.log(chalkTemplate`  {yellow ⚠} 24-bit FLAC detected, downsampling required`);

    // Store the 24-bit version
    result.flac24 = releaseDir;

    // Downsample to 16-bit
    // Remove -24 from the format tag (e.g., [WEB-FLAC-24] -> [WEB-FLAC], [FLAC-24-96] -> [FLAC])
    const downsampledBasename = releaseInfo.basename.replace(/\[([^\]]*?)(?:-24[^\]]*?)?\]/, (match, prefix) => {
      // Remove -24 and anything after it within the tag
      const cleaned = prefix.replace(/-24.*$/, "");
      return `[${cleaned}]`;
    });
    const downsampledDir = path.join(env.OUTPUT_DIR, downsampledBasename);

    try {
      await downsample24BitFlac(releaseDir, downsampledDir);
      result.flac = downsampledDir;

      // Transcode the downsampled version
      if (!skip320) {
        result.mp3_320 = await transcodeToMP3({
          inputDir: downsampledDir,
          outputDir: env.OUTPUT_DIR,
          format: "320",
          queue,
          discs: releaseInfo.discs,
        });

        // Validate 320 durations
        if (flacDurations) {
          await validateTranscodedDurations(result.mp3_320, flacDurations, queue);
        }
      } else {
        console.log(chalkTemplate`  {cyan ℹ} Skipping 320 transcoding (all trackers have no320)`);
      }

      result.mp3_v0 = await transcodeToMP3({
        inputDir: downsampledDir,
        outputDir: env.OUTPUT_DIR,
        format: "V0",
        queue,
        discs: releaseInfo.discs,
      });

      // Validate V0 durations
      if (flacDurations) {
        await validateTranscodedDurations(result.mp3_v0, flacDurations, queue);
      }
    } catch (error) {
      console.error(chalkTemplate`  {red ✗} Downsampling not yet implemented`);
      console.error(error);
    }
  } else {
    // 16-bit FLAC
    result.flac = releaseDir;

    if (!skip320) {
      result.mp3_320 = await transcodeToMP3({
        inputDir: releaseDir,
        outputDir: env.OUTPUT_DIR,
        format: "320",
        queue,
        discs: releaseInfo.discs,
      });

      // Validate 320 durations
      if (flacDurations) {
        await validateTranscodedDurations(result.mp3_320, flacDurations, queue);
      }
    } else {
      console.log(chalkTemplate`  {cyan ℹ} Skipping 320 transcoding (all trackers have no320)`);
    }

    result.mp3_v0 = await transcodeToMP3({
      inputDir: releaseDir,
      outputDir: env.OUTPUT_DIR,
      format: "V0",
      queue,
      discs: releaseInfo.discs,
    });

    // Validate V0 durations
    if (flacDurations) {
      await validateTranscodedDurations(result.mp3_v0, flacDurations, queue);
    }
  }

  // Step 3.5: Handle BD/DVD/photobook discs
  if (releaseInfo.hasBluray || releaseInfo.hasDVD || releaseInfo.hasPhotobook) {
    console.log(chalkTemplate`{bold Step 3.5:} Preparing BD/DVD/Photobook torrents...`);
    
    // Use the original source directory (FLAC 24-bit or 16-bit)
    // All BD/DVD/photobook torrents will reference the same base directory
    const sourceDir = result.flac24 || result.flac || releaseDir;
    
    // For BD/DVD/photobook, we don't create separate copies
    // Instead, we'll just mark them for torrent creation
    // The torrent creator will include only the relevant discs
    if (releaseInfo.hasBluray) {
      result.bluray = sourceDir;
      console.log(chalkTemplate`    {green ✓} Marked Blu-ray discs for torrent creation`);
    }
    
    if (releaseInfo.hasDVD) {
      result.dvd = sourceDir;
      console.log(chalkTemplate`    {green ✓} Marked DVD discs for torrent creation`);
    }
    
    if (releaseInfo.hasPhotobook) {
      result.photobook = sourceDir;
      console.log(chalkTemplate`    {green ✓} Marked photobook for torrent creation`);
    }
  }

  // Step 4: Create torrents
  console.log(chalkTemplate`{bold Step 4:} Creating torrents...`);

  await createTorrentsForRelease(result, trackers, env.TORRENT_DIR, releaseInfo.discs);

  // Wait for spectrograms to finish before moving files
  if (spectrogramQueue) {
    console.log(chalkTemplate`  {blue →} Waiting for spectrograms to finish...`);
    await spectrogramQueue.onIdle();
    console.log(chalkTemplate`  {green ✓} Spectrograms completed`);
  }

  // Step 5: Move input files to output directory
  if (!noMove) {
    console.log(chalkTemplate`{bold Step 5:} Moving input files to output...`);

    const inputBasename = path.basename(releaseDir);
    const outputPath = path.join(env.OUTPUT_DIR, inputBasename);

    // Check if destination already exists
    try {
      await fs.access(outputPath);
      console.log(chalkTemplate`  {yellow ⚠} Destination already exists, skipping move: ${inputBasename}`);
    } catch {
      // Destination doesn't exist, safe to move
      await fs.rename(releaseDir, outputPath);
      console.log(chalkTemplate`  {green ✓} Moved input files to output directory`);

      // Update result paths if this was the FLAC source
      if (result.flac === releaseDir) {
        result.flac = outputPath;
      }
      if (result.flac24 === releaseDir) {
        result.flac24 = outputPath;
      }
    }
  } else {
    console.log(chalkTemplate`{bold Step 5:} Skipping move (--no-move flag set)`);
  }

  console.log(chalkTemplate`{bold.green ✓ Completed:} ${releaseInfo.basename}\n`);

  return result;
}

/**
 * Scan input directory for releases to process
 */
export async function scanInputDirectory(): Promise<string[]> {
  const entries = await fs.readdir(env.INPUT_DIR, { withFileTypes: true });
  const releases: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(env.INPUT_DIR, entry.name);

    if (entry.isDirectory()) {
      // Check if it's a release directory (has format tag)
      if (/\[[^\]]+\]$/.test(entry.name)) {
        releases.push(fullPath);
      }
    } else if (entry.isFile()) {
      // Bare files should be packed into release directories
      console.warn(chalkTemplate`{yellow ⚠} Warning: Bare file found in INPUT_DIR: ${entry.name}`);
      console.warn(chalkTemplate`  {gray Files should be organized into release directories}`);
    }
  }

  return releases;
}

/**
 * Load tracker configuration
 */
export async function loadTrackers(requestedTrackers?: string[]): Promise<TrackerConfig[]> {
  const trackersPath = path.join(process.cwd(), "trackers.json");
  const trackersJson = await fs.readFile(trackersPath, "utf-8");
  const trackersConfig: TrackersConfig = JSON.parse(trackersJson);

  // If specific trackers are requested, use those
  if (requestedTrackers && requestedTrackers.length > 0) {
    const trackers: TrackerConfig[] = [];
    for (const name of requestedTrackers) {
      const tracker = trackersConfig[name];
      if (!tracker) {
        throw new Error(`Unknown tracker: ${name}`);
      }
      trackers.push(tracker);
    }
    return trackers;
  }

  // Otherwise, return only default trackers
  return Object.values(trackersConfig).filter((tracker) => tracker.default !== false);
}

/**
 * Check if all trackers have no320 flag set
 */
export function shouldSkip320(trackers: TrackerConfig[]): boolean {
  return trackers.length > 0 && trackers.every((tracker) => tracker.no320 === true);
}
