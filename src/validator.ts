import * as path from "node:path";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { parseFile } from "music-metadata";
import { getAllFiles } from "./file-utils.ts";
import { findFiles } from "./file-utils.ts";
import { printVerificationWarning } from "./warning-utils.ts";
import { testFlacFile, getAudioFileInfo, validateChannelCount, getFlacBitDepth } from "./audio-test.ts";
import { runHbcl } from "./hbcl.ts";
import { parseReleaseDirectory, hasBitrateInFormatTag } from "./release-parser.ts";
import type { AudioFileInfo } from "./types.ts";

/**
 * Validate all FLAC files in a directory
 */
export async function validateFlacFiles(releaseDir: string, queue: PQueue): Promise<void> {
  const flacFiles = await findFiles(releaseDir, /\.flac$/i);

  if (flacFiles.length === 0) {
    return;
  }

  console.log(chalkTemplate`  {blue →} Testing ${flacFiles.length} FLAC files...`);

  await Promise.all(
    flacFiles.map((file) =>
      queue.add(async () => {
        await testFlacFile(file);
      }),
    ),
  );

  console.log(chalkTemplate`  {green ✓} All FLAC files passed integrity test`);
}

/**
 * Check for FLAC files with ID3 tags instead of Vorbis comments
 */
export async function checkForId3Tags(releaseDir: string, queue: PQueue): Promise<void> {
  const flacFiles = await findFiles(releaseDir, /\.flac$/i);

  if (flacFiles.length === 0) {
    return;
  }

  const filesWithId3 = await Promise.all(
    flacFiles.map((file) =>
      queue.add(async () => {
        try {
          const metadata = await parseFile(file);
          const hasId3 =
            metadata.format.container === "FLAC" &&
            metadata.format.tagTypes &&
            metadata.format.tagTypes.length > 0 &&
            metadata.format.tagTypes[0].toLowerCase() !== "vorbis";
          return hasId3 ? path.basename(file) : null;
        } catch {
          return null;
        }
      }),
    ),
  );

  const id3Files = filesWithId3.filter((f): f is string => f !== null);

  if (id3Files.length > 0) {
    printVerificationWarning("WARNING: FLAC FILES WITH ID3 TAGS DETECTED", [
      `Found ${id3Files.length} FLAC file(s) with ID3 tags instead of Vorbis comments`,
      `FLAC files should use Vorbis comments, not ID3 tags`,
      `Files: ${id3Files.slice(0, 5).join(", ")}${id3Files.length > 5 ? ` and ${id3Files.length - 5} more` : ""}`,
    ]);
  }
}

/**
 * Validate audio files have sane channel counts and durations
 * Returns a map of file paths to durations for later validation
 */
export async function validateAudioFiles(releaseDir: string, queue: PQueue): Promise<Map<string, number>> {
  const audioFiles = await findFiles(releaseDir, /\.(flac|mp3|m4a|wav)$/i);

  if (audioFiles.length === 0) {
    return new Map();
  }

  console.log(chalkTemplate`  {blue →} Validating ${audioFiles.length} audio files...`);

  const results = await Promise.all(
    audioFiles.map(
      (file) =>
        queue.add(async () => {
          const info = await getAudioFileInfo(file);
          validateChannelCount(info);
          return info;
        }) as Promise<AudioFileInfo>,
    ),
  );

  // Check for any files with suspicious durations (< 1 second might be corrupt)
  const suspiciousFiles = results.filter((info) => info.duration < 1);

  if (suspiciousFiles.length > 0) {
    console.warn(chalkTemplate`  {yellow ⚠} Warning: ${suspiciousFiles.length} files have duration < 1 second`);
    for (const info of suspiciousFiles) {
      console.warn(chalkTemplate`    {yellow -} ${path.basename(info.path)}: ${info.duration}s`);
    }
  }

  console.log(chalkTemplate`  {green ✓} All audio files have valid channel counts`);

  // Create a map of relative paths to durations
  const durationMap = new Map<string, number>();
  for (const info of results) {
    const relativePath = path.relative(releaseDir, info.path);
    durationMap.set(relativePath, info.duration);
  }

  return durationMap;
}

/**
 * Validate FLAC bitrate and check if 24-bit files are properly tagged
 */
export async function validateFlacBitrate(releaseDir: string, queue: PQueue): Promise<void> {
  const flacFiles = await findFiles(releaseDir, /\.flac$/i);

  if (flacFiles.length === 0) {
    return;
  }

  console.log(chalkTemplate`  {blue →} Checking FLAC bit depths...`);

  const bitDepths = await Promise.all(
    flacFiles.map((file) =>
      queue.add(async () => {
        const bitDepth = await getFlacBitDepth(file);
        return { file, bitDepth };
      }),
    ),
  );

  const has24Bit = bitDepths.some((result) => result && result.bitDepth === 24);

  if (has24Bit) {
    const releaseInfo = await parseReleaseDirectory(releaseDir);
    const hasBitrateTag = hasBitrateInFormatTag(releaseInfo.basename);

    if (!hasBitrateTag) {
      throw new Error(
        chalkTemplate`{red ERROR:} Directory contains 24-bit FLAC files but format tag does not indicate bitrate.\n` +
          chalkTemplate`  Directory: ${releaseInfo.basename}\n` +
          chalkTemplate`  Expected format tags like: [FLAC-24], [FLAC-24-48], [CD-FLAC-24], etc.`,
      );
    }

    console.log(chalkTemplate`  {green ✓} 24-bit FLAC files properly tagged in directory name`);
  } else {
    console.log(chalkTemplate`  {green ✓} All FLAC files are 16-bit`);
  }
}

/**
 * Check for files, directories, or FLAC tags that are not NFC normalized
 */
export async function checkUnicodeNormalization(releaseDir: string, queue: PQueue): Promise<void> {
  const issues: string[] = [];

  // Check directory names and file names
  const allFiles = await getAllFiles(releaseDir);
  const releaseBasename = path.basename(releaseDir);

  // Check release directory name
  const normalizedReleaseName = releaseBasename.normalize("NFC");
  if (releaseBasename !== normalizedReleaseName) {
    issues.push(`Release directory name: "${releaseBasename}"`);
  }

  // Check all file and directory paths
  for (const file of allFiles) {
    const relativePath = path.relative(releaseDir, file);
    const normalizedPath = relativePath.normalize("NFC");
    if (relativePath !== normalizedPath) {
      issues.push(`Path: "${relativePath}"`);
    }
  }

  // Check FLAC tags
  const flacFiles = await findFiles(releaseDir, /\.flac$/i);
  if (flacFiles.length > 0) {
    const tagIssues = await Promise.all(
      flacFiles.map((file) =>
        queue.add(async () => {
          try {
            const metadata = await parseFile(file);
            const fileIssues: string[] = [];
            const basename = path.basename(file);

            // Check common tags
            const tagsToCheck = [
              { key: "title", value: metadata.common.title },
              { key: "album", value: metadata.common.album },
              { key: "artist", value: metadata.common.artist },
              { key: "albumartist", value: metadata.common.albumartist },
              { key: "genre", value: metadata.common.genre?.join(", ") },
              {
                key: "comment",
                value: metadata.common.comment?.map((c) => (typeof c === "string" ? c : c.text)).join("; "),
              },
            ];

            for (const tag of tagsToCheck) {
              if (tag.value) {
                const normalized = tag.value.normalize("NFC");
                if (tag.value !== normalized) {
                  fileIssues.push(`${basename} - ${tag.key.toUpperCase()} tag`);
                }
              }
            }

            return fileIssues;
          } catch {
            return [];
          }
        }),
      ),
    );

    for (const fileIssues of tagIssues) {
      if (fileIssues) {
        issues.push(...fileIssues);
      }
    }
  }

  if (issues.length > 0) {
    printVerificationWarning("WARNING: NON-NFC NORMALIZED UNICODE DETECTED", [
      `Found ${issues.length} file(s), directory(ies), or tag(s) with non-NFC normalized Unicode`,
      `This can cause issues with file systems and torrent clients`,
      `Items: ${issues.slice(0, 5).join(", ")}${issues.length > 5 ? ` and ${issues.length - 5} more` : ""}`,
    ]);
  }
}

/**
 * Test all .log files with hbcl
 */
export async function validateLogFiles(releaseDir: string, queue: PQueue): Promise<void> {
  const logFiles = await findFiles(releaseDir, /\.log$/i);

  if (logFiles.length === 0) {
    return;
  }

  console.log(chalkTemplate`  {blue →} Testing ${logFiles.length} log files with hbcl...`);

  for (const logFile of logFiles) {
    await queue.add(async () => {
      try {
        const result = await runHbcl(logFile);

        if (result.logUnrecognized) {
          console.log(chalkTemplate`  {yellow ⚠} ${path.basename(logFile)}: Log is unrecognized`);
        } else if (result.logEdited) {
          console.log(chalkTemplate`  {yellow ⚠} ${path.basename(logFile)}: Log checksum does not match (edited)`);
        } else if (result.score !== null) {
          const scoreColor = result.score === 100 ? "green" : result.score >= 95 ? "cyan" : "yellow";
          console.log(chalkTemplate`  {${scoreColor} ✓} ${path.basename(logFile)}: Score ${result.score}`);
        }
      } catch (error) {
        console.error(chalkTemplate`  {red ✗} ${path.basename(logFile)}: Failed to check log`);
        console.error(error);
      }
    });
  }
}
