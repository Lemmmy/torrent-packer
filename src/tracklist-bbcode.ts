import * as path from "node:path";
import * as fs from "node:fs/promises";
import chalk from "chalk";
import { parseReleaseDirectory } from "./release-parser.ts";
import { findFiles } from "./file-utils.ts";
import { getAudioFileInfo } from "./audio-test.ts";
import { readFlacMetadata } from "./metadata.ts";
import { printBanner } from "./warning-utils.ts";

interface TrackEntry {
  title: string;
  durationSeconds: number;
}

interface DiscTrackInfo {
  discLabel: string;
  tracks: TrackEntry[];
  totalSeconds: number;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const mm = minutes.toString();
  const ss = secs.toString().padStart(2, "0");

  if (hours > 0) {
    const hh = hours.toString();
    return `${hh}:${mm.padStart(2, "0")}:${ss}`;
  }

  return `${mm}:${ss}`;
}

async function collectDiscTracks(discPath: string, discIndex: number): Promise<DiscTrackInfo | null> {
  const flacFiles = await findFiles(discPath, /\.flac$/i);

  if (flacFiles.length === 0) {
    return null;
  }

  // Sort files by path to keep natural order
  flacFiles.sort((a, b) => a.localeCompare(b));

  const tracks: TrackEntry[] = [];

  for (let i = 0; i < flacFiles.length; i++) {
    const filePath = flacFiles[i];
    const [audioInfo, metadata] = await Promise.all([getAudioFileInfo(filePath), readFlacMetadata(filePath)]);

    const trackNumberFromTag = metadata.TRACKNUMBER ? parseInt(metadata.TRACKNUMBER, 10) : i + 1;
    const titleFromTag = metadata.TITLE;

    const title =
      titleFromTag && titleFromTag.trim().length > 0 ? titleFromTag : path.basename(filePath, path.extname(filePath));

    tracks.push({
      title,
      durationSeconds: audioInfo.duration,
    });
  }

  const totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);

  return {
    discLabel: `Disc ${discIndex}`,
    tracks,
    totalSeconds,
  };
}

interface ReleaseCandidate {
  path: string;
  albumName: string;
  media: string;
}

async function discoverReleases(inputDir: string, outputDir: string): Promise<ReleaseCandidate[]> {
  const candidates: ReleaseCandidate[] = [];
  const seenPaths = new Set<string>();

  async function scanDirectory(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const fullPath = path.join(dir, entry.name);
        const basename = entry.name;

        // Check if this looks like a release directory (has format tag)
        const formatMatch = basename.match(/\[([^\]]+)\]$/);
        if (formatMatch) {
          const formatTag = formatMatch[1];

          // Only look at FLAC versions
          if (/FLAC/i.test(formatTag)) {
            // Extract the base name without format tag for deduplication
            // e.g., "[2006.07.01] Artist — Album {CAT}" from "[2006.07.01] Artist — Album {CAT} [CD-FLAC]"
            const baseName = basename.replace(/\s*\[[^\]]+\]$/, "");

            // Deduplicate by base release name (same album, different formats)
            if (!seenPaths.has(baseName)) {
              seenPaths.add(baseName);

              // Find first FLAC file to get album name
              const flacFiles = await findFiles(fullPath, /\.flac$/i);
              if (flacFiles.length > 0) {
                const metadata = await readFlacMetadata(flacFiles[0]);
                const albumName = metadata.ALBUM || "Unknown Album";

                // Extract media type (e.g., "CD", "WEB", "Vinyl")
                const mediaMatch = formatTag.match(/^(\d*[A-Za-z]+r?)-/);
                const media = mediaMatch ? mediaMatch[1].replace(/^\d+/, "") : "Unknown";

                candidates.push({
                  path: fullPath,
                  albumName,
                  media,
                });
              }
            }
          }
        } else {
          // Recurse into subdirectories
          await scanDirectory(fullPath);
        }
      }
    } catch (error) {
      // Ignore directories we can't read
    }
  }

  await scanDirectory(inputDir);
  await scanDirectory(outputDir);

  return candidates;
}

function generateBBCodeTracklist(
  discInfos: DiscTrackInfo[],
  totalSecondsAllDiscs: number,
  usePlainTags: boolean,
): string {
  const lines: string[] = [];
  lines.push("[size=3][b]Tracklist[/b][/size]");
  lines.push("");

  if (discInfos.length === 1) {
    const disc = discInfos[0];
    const tracks = disc.tracks;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const trackNumber = i + 1;
      const trackNumberStr = trackNumber.toString().padStart(2, "0");
      const durationStr = formatDuration(track.durationSeconds);

      let title = track.title;
      if (usePlainTags) {
        title = `[plain]${title}[/plain]`;
      } else {
        // Insert zero-width spaces before and after colons
        title = title.replace(/:/g, "\u200B:\u200B");
      }

      let line = "";
      if (i === 0) {
        line += "[size=2" + "]";
      }

      line += `[b]${trackNumberStr}[/b]. ${title} [i][${durationStr}][/i]`;

      if (i === tracks.length - 1) {
        line += "[/size]";
      }

      lines.push(line);
    }
  } else {
    for (const disc of discInfos) {
      const discTotalStr = formatDuration(disc.totalSeconds);
      lines.push(`[size=2][b]${disc.discLabel}[/b][/size]\t[size=1][i][${discTotalStr}][/i][/size]`);

      const tracks = disc.tracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const trackNumber = i + 1;
        const trackNumberStr = trackNumber.toString().padStart(2, "0");
        const durationStr = formatDuration(track.durationSeconds);

        let title = track.title;
        if (usePlainTags) {
          title = `[plain]${title}[/plain]`;
        } else {
          // Insert zero-width spaces before and after colons
          title = title.replace(/:/g, "\u200B:\u200B");
        }

        let line = "";
        if (i === 0) {
          line += "[size=2" + "]";
        }

        line += `[b]${trackNumberStr}[/b]. ${title} [i][${durationStr}][/i]`;

        if (i === tracks.length - 1) {
          line += "[/size]";
        }

        lines.push(line);
      }

      lines.push("");
    }

    // Remove extra blank line after last disc
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
  }

  lines.push("");
  lines.push("——————————");
  lines.push(`Total time: [i]${formatDuration(totalSecondsAllDiscs)}[/i]`);

  return lines.join("\n");
}

function generatePlainTracklist(discInfos: DiscTrackInfo[]): string {
  const lines: string[] = [];

  for (const disc of discInfos) {
    if (discInfos.length > 1) {
      lines.push(`${disc.discLabel}`);
    }

    const tracks = disc.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const trackNumber = i + 1;
      const trackNumberStr = trackNumber.toString().padStart(2, "0");
      const durationStr = formatDuration(track.durationSeconds);

      lines.push(`${trackNumberStr} ${track.title} ${durationStr}`);
    }

    if (discInfos.length > 1) {
      lines.push("");
    }
  }

  // Remove trailing blank line if present
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

export async function generateTracklistBBCode(
  releaseDir: string | null,
  forceType?: "cd" | "bd" | "dvd",
): Promise<string> {
  // If no release directory specified, discover releases recursively
  if (!releaseDir) {
    const { env } = await import("./env.ts");
    const releases = await discoverReleases(env.INPUT_DIR, env.OUTPUT_DIR);

    if (releases.length === 0) {
      return "No FLAC releases found in input or output directories.";
    }

    // Process all discovered releases
    for (const selectedRelease of releases) {
      printBanner(selectedRelease.albumName, [], "cyan");

      const release = await parseReleaseDirectory(selectedRelease.path, forceType);
      const cdDiscs = release.discs.filter((disc) => disc.type === "cd");
      const discInfos: DiscTrackInfo[] = [];

      for (let i = 0; i < cdDiscs.length; i++) {
        const disc = cdDiscs[i];
        const info = await collectDiscTracks(disc.path, i + 1);
        if (info && info.tracks.length > 0) {
          discInfos.push(info);
        }
      }

      if (discInfos.length === 0) {
        continue;
      }

      const totalSecondsAllDiscs = discInfos.reduce((sum, d) => sum + d.totalSeconds, 0);

      // Print all three tracklist formats directly to console
      console.log(chalk.cyan.underline("BBCode Tracklist (with [plain] tags)"));
      console.log("");
      console.log(generateBBCodeTracklist(discInfos, totalSecondsAllDiscs, true));
      console.log("");
      console.log("");

      console.log(chalk.magenta.underline("BBCode Tracklist (with zero-width spaces)"));
      console.log("");
      console.log(generateBBCodeTracklist(discInfos, totalSecondsAllDiscs, false));
      console.log("");
      console.log("");

      console.log(chalk.green.underline("Plain Tracklist (VGMdb format)"));
      console.log("");
      console.log(generatePlainTracklist(discInfos));
      console.log("");
      console.log("");
    }

    return "";
  }

  const release = await parseReleaseDirectory(releaseDir, forceType);

  // Only include audio discs (CD)
  const cdDiscs = release.discs.filter((disc) => disc.type === "cd");

  const discInfos: DiscTrackInfo[] = [];

  for (let i = 0; i < cdDiscs.length; i++) {
    const disc = cdDiscs[i];
    const info = await collectDiscTracks(disc.path, i + 1);
    if (info && info.tracks.length > 0) {
      discInfos.push(info);
    }
  }

  if (discInfos.length === 0) {
    return "";
  }

  const totalSecondsAllDiscs = discInfos.reduce((sum, d) => sum + d.totalSeconds, 0);

  // Generate all three tracklist formats
  const output: string[] = [];

  // 1. BBCode with [plain] tags
  output.push(chalk.cyan.underline("BBCode Tracklist (with [plain] tags)"));
  output.push("");
  output.push(generateBBCodeTracklist(discInfos, totalSecondsAllDiscs, true));
  output.push("");
  output.push("");

  // 2. BBCode with zero-width spaces around colons
  output.push(chalk.magenta.underline("BBCode Tracklist (with zero-width spaces)"));
  output.push("");
  output.push(generateBBCodeTracklist(discInfos, totalSecondsAllDiscs, false));
  output.push("");
  output.push("");

  // 3. Plain VGMdb format
  output.push(chalk.green.underline("Plain Tracklist (VGMdb format)"));
  output.push("");
  output.push(generatePlainTracklist(discInfos));

  return output.join("\n");
}
