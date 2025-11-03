import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { env } from "./env.ts";
import { findFiles, copyDirectoryStructure } from "./file-utils.ts";
import { printVerificationWarning } from "./warning-utils.ts";

const execFileAsync = promisify(execFile);

interface FlacFileInfo {
  path: string;
  sampleRate: number;
  bitDepth: number;
}

/**
 * Get sample rate and bit depth from a FLAC file using metaflac
 */
async function getFlacSpecs(filePath: string): Promise<FlacFileInfo> {
  const { stdout: sampleRateOutput } = await execFileAsync(env.METAFLAC_PATH, ["--show-sample-rate", filePath], {
    windowsHide: true,
  });

  const { stdout: bitDepthOutput } = await execFileAsync(env.METAFLAC_PATH, ["--show-bps", filePath], {
    windowsHide: true,
  });

  const sampleRate = parseInt(sampleRateOutput.trim(), 10);
  const bitDepth = parseInt(bitDepthOutput.trim(), 10);

  return { path: filePath, sampleRate, bitDepth };
}

/**
 * Determine target sample rate based on source sample rate
 * 192 kHz or 96 kHz -> 48 kHz
 * 176.4 kHz or 88.2 kHz -> 44.1 kHz
 * 48 kHz or 44.1 kHz -> same (no actual resampling, but rate effect still applied)
 */
function getTargetSampleRate(sourceSampleRate: number): number {
  if (sourceSampleRate === 192000 || sourceSampleRate === 96000) {
    return 48000;
  } else if (sourceSampleRate === 176400 || sourceSampleRate === 88200) {
    return 44100;
  } else if (sourceSampleRate === 48000 || sourceSampleRate === 44100) {
    return sourceSampleRate;
  }

  throw new Error(
    `Unsupported sample rate for downsampling: ${sourceSampleRate} Hz. ` +
      `Supported rates: 192000, 176400, 96000, 88200, 48000, 44100`,
  );
}

/**
 * Downsample a single FLAC file from 24-bit to 16-bit using SoX
 * Always uses rate effect even if sample rate doesn't change (SoX handles this efficiently)
 */
async function downsampleFlacFile(inputPath: string, outputPath: string, sourceSampleRate: number): Promise<void> {
  const targetSampleRate = getTargetSampleRate(sourceSampleRate);

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Build SoX command
  // sox -S input.flac -R -G -b 16 output.flac rate -v -L <target_rate> dither
  const soxArgs = [
    "-S", // Silent mode
    inputPath,
    "-R", // Use default random number generator
    "-G", // Enable guard against clipping
    "-b",
    "16", // 16-bit output
    outputPath,
    "rate",
    "-v",
    "-L", // Rate effect: very high quality, linear phase
    targetSampleRate.toString(),
    "dither", // Apply dither
  ];

  await execFileAsync(env.SOX_PATH, soxArgs, {
    windowsHide: true,
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large files
  });

  // Add padding to the output FLAC file
  await execFileAsync(env.METAFLAC_PATH, ["--add-padding=4096", outputPath], {
    windowsHide: true,
  });
}

/**
 * Downsample 24-bit FLAC files to 16-bit FLAC files
 * Converts to common multiples:
 * - 192/96 kHz -> 48 kHz
 * - 176.4/88.2 kHz -> 44.1 kHz
 *
 * If mixed bit depths are found, 24-bit files are downsampled and 16-bit files are copied as-is
 */
export async function downsample24BitFlac(inputDir: string, outputDir: string): Promise<void> {
  const queue = new PQueue({ concurrency: env.CONCURRENCY_LIMIT });

  console.log(chalkTemplate`  {blue →} Downsampling 24-bit FLAC to 16-bit...`);

  // Find all FLAC files
  const flacFiles = await findFiles(inputDir, /\.flac$/i);

  if (flacFiles.length === 0) {
    throw new Error(`No FLAC files found in ${inputDir}`);
  }

  // Get specs for all FLAC files
  console.log(chalkTemplate`    {gray Analyzing ${flacFiles.length} FLAC files...}`);

  const fileSpecs = await Promise.all(flacFiles.map((file) => getFlacSpecs(file)));

  // Separate files by bit depth
  const files24Bit = fileSpecs.filter((spec) => spec.bitDepth === 24);
  const files16Bit = fileSpecs.filter((spec) => spec.bitDepth === 16);
  const filesOtherBitDepth = fileSpecs.filter((spec) => spec.bitDepth !== 24 && spec.bitDepth !== 16);

  // Check for unsupported bit depths
  if (filesOtherBitDepth.length > 0) {
    throw new Error(`Found ${filesOtherBitDepth.length} files with unsupported bit depths (not 16 or 24)`);
  }

  // Warn about mixed bit depths
  if (files16Bit.length > 0 && files24Bit.length > 0) {
    printVerificationWarning("WARNING: MIXED BIT DEPTH RELEASE DETECTED", [
      `Found ${files24Bit.length} × 24-bit files and ${files16Bit.length} × 16-bit files`,
      `This release must be designated as MIXED BITRATE`,
      `Follow tracker-specific rules for mixed bitrate releases`,
    ]);
  }

  // Copy directory structure and non-FLAC files
  await copyDirectoryStructure(inputDir, outputDir, (filename) => {
    return !filename.toLowerCase().endsWith(".flac");
  });

  // Process files
  console.log(chalkTemplate`    {gray Processing ${flacFiles.length} files...}`);

  await Promise.all([
    // Downsample 24-bit files
    ...files24Bit.map((spec) =>
      queue.add(async () => {
        const relativePath = path.relative(inputDir, spec.path);
        const outputPath = path.join(outputDir, relativePath);
        await downsampleFlacFile(spec.path, outputPath, spec.sampleRate);
      }),
    ),
    // Copy 16-bit files as-is
    ...files16Bit.map((spec) =>
      queue.add(async () => {
        const relativePath = path.relative(inputDir, spec.path);
        const outputPath = path.join(outputDir, relativePath);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.copyFile(spec.path, outputPath);
      }),
    ),
  ]);

  if (files24Bit.length > 0 && files16Bit.length > 0) {
    console.log(
      chalkTemplate`  {green ✓} Downsampled ${files24Bit.length} × 24-bit files, copied ${files16Bit.length} × 16-bit files`,
    );
  } else if (files24Bit.length > 0) {
    console.log(chalkTemplate`  {green ✓} Downsampled ${files24Bit.length} files to 16-bit`);
  } else {
    console.log(chalkTemplate`  {green ✓} Copied ${files16Bit.length} × 16-bit files (no downsampling needed)`);
  }
}
