import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { env } from "./env.ts";
import { findFiles, copyDirectoryStructure } from "./file-utils.ts";
import { replaceFormatTag } from "./release-parser.ts";
import { readFlacMetadata, buildLameTagArgs } from "./metadata.ts";

export interface TranscodeOptions {
  inputDir: string;
  outputDir: string;
  format: "320" | "V0";
  queue: PQueue;
}

/**
 * Transcode FLAC files to MP3 320 or V0
 */
export async function transcodeToMP3(options: TranscodeOptions): Promise<string> {
  const { inputDir, outputDir, format, queue } = options;

  const inputBasename = path.basename(inputDir);
  const outputBasename = replaceFormatTag(inputBasename, format);
  const outputPath = path.join(outputDir, outputBasename);

  console.log(chalkTemplate`  {blue →} Transcoding to ${format}: ${outputBasename}`);

  // Create output directory and copy non-FLAC files
  await copyDirectoryStructure(inputDir, outputPath, (filename) => {
    return !filename.toLowerCase().endsWith(".flac");
  });

  // Find all FLAC files
  const flacFiles = await findFiles(inputDir, /\.flac$/i);

  console.log(chalkTemplate`    {gray Transcoding ${flacFiles.length} files...}`);

  // Transcode each FLAC file
  await Promise.all(
    flacFiles.map((flacFile) =>
      queue.add(async () => {
        await transcodeFlacToMP3(flacFile, inputDir, outputPath, format);
      }),
    ),
  );

  console.log(chalkTemplate`  {green ✓} Transcoded to ${format}: ${outputBasename}`);

  return outputPath;
}

/**
 * Transcode a single FLAC file to MP3
 * Uses flac to decode and pipes to lame for encoding
 */
async function transcodeFlacToMP3(
  flacFile: string,
  inputBaseDir: string,
  outputBaseDir: string,
  format: "320" | "V0",
): Promise<void> {
  // Calculate relative path and output path
  const relativePath = path.relative(inputBaseDir, flacFile);
  const outputPath = path.join(outputBaseDir, relativePath.replace(/\.flac$/i, ".mp3"));

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Read FLAC metadata
  let tagArgs: string[] = [];
  try {
    const metadata = await readFlacMetadata(flacFile);
    tagArgs = buildLameTagArgs(metadata);
  } catch (error) {
    // If metadata reading fails, log warning but continue
    console.warn(chalkTemplate`    {yellow ⚠} Failed to read metadata from ${path.basename(flacFile)}: ${error}`);
  }

  // Build base lame command arguments
  const baseArgs =
    format === "320"
      ? ["--silent", "-q", "0", "-b", "320", "--ignore-tag-errors", "--noreplaygain"]
      : ["--silent", "-q", "0", "-V", "0", "--vbr-new", "--ignore-tag-errors", "--noreplaygain"];

  // Combine base args, tag args, and specify stdin input and output file
  const lameArgs = [
    ...baseArgs,
    ...tagArgs,
    "--add-id3v2",
    "-", // Read from stdin
    outputPath,
  ];

  // Spawn flac decoder process: flac -sdc -- <file>
  // -s: silent
  // -d: decode
  // -c: output to stdout
  const flacProcess = spawn(env.FLAC_PATH, ["-sdc", "--", flacFile], {
    windowsHide: true,
  });

  // Spawn lame encoder process
  const lameProcess = spawn(env.LAME_PATH, lameArgs, {
    windowsHide: true,
  });

  // Pipe flac output to lame input
  flacProcess.stdout.pipe(lameProcess.stdin);

  // Collect error output
  let flacError = "";
  let lameError = "";

  flacProcess.stderr.on("data", (data) => {
    flacError += data.toString();
  });

  lameProcess.stderr.on("data", (data) => {
    lameError += data.toString();
  });

  // Wait for both processes to complete
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      flacProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`FLAC decode failed with code ${code}: ${flacError.trim()}`));
        } else {
          resolve();
        }
      });
      flacProcess.on("error", reject);
    }),
    new Promise<void>((resolve, reject) => {
      lameProcess.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`LAME encode failed with code ${code}: ${lameError.trim()}`));
        } else {
          resolve();
        }
      });
      lameProcess.on("error", reject);
    }),
  ]);
}
