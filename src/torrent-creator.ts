import * as fs from "node:fs";
import * as path from "node:path";
import createTorrent from "create-torrent";
import chalkTemplate from "chalk-template";
import { getAllFiles, matchesPattern } from "./file-utils.ts";
import type { TrackerConfig, DiscInfo } from "./types.ts";

export interface TorrentCreationOptions {
  releaseDir: string;
  outputDir: string;
  tracker: TrackerConfig;
  suffix?: string;
  discs?: DiscInfo[];
  includeDiscTypes?: ("cd" | "bd" | "dvd" | "photobook")[];
}

/**
 * Calculate optimal piece length based on total torrent size
 * Algorithm from mktorrent: https://github.com/pobrn/mktorrent/commit/ea1fbf29d19f34a93f7d984c1ac29d6d08f1f508
 */
function calculatePieceLength(totalSize: number): number {
  const ONEMEG = 1048576; // 1 MB in bytes

  // Maximum torrent size in MB for each piece length (power of 2)
  // Index represents the power (e.g., index 15 = 2^15 bytes = 32 KB pieces)
  const pieceLengthMaxes = [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0, // 0-14: unused
    50 * ONEMEG, // 15: 2^15 = 32 KB pieces, max 50 MB torrent
    100 * ONEMEG, // 16: 2^16 = 64 KB pieces, max 100 MB torrent
    200 * ONEMEG, // 17: 2^17 = 128 KB pieces, max 200 MB torrent
    400 * ONEMEG, // 18: 2^18 = 256 KB pieces, max 400 MB torrent
    800 * ONEMEG, // 19: 2^19 = 512 KB pieces, max 800 MB torrent
    1600 * ONEMEG, // 20: 2^20 = 1 MB pieces, max 1600 MB torrent
    3200 * ONEMEG, // 21: 2^21 = 2 MB pieces, max 3200 MB torrent
    6400 * ONEMEG, // 22: 2^22 = 4 MB pieces, max 6400 MB torrent (max piece size)
  ];

  // Find the smallest piece length that can accommodate the torrent size
  for (let i = 15; i < pieceLengthMaxes.length; i++) {
    if (totalSize <= pieceLengthMaxes[i]) {
      return 1 << i; // Return 2^i bytes
    }
  }

  // If torrent is larger than all maxes, use the largest piece size (2^22 = 4 MB)
  return 1 << 22;
}

/**
 * Create a torrent file for a release directory
 */
export async function createTorrentFile(options: TorrentCreationOptions): Promise<string> {
  const { releaseDir, outputDir, tracker, suffix, discs = [], includeDiscTypes } = options;

  const releaseName = path.basename(releaseDir);
  const suffixPart = suffix ? `-${suffix}` : "";
  const torrentFileName = `${releaseName}${suffixPart}-${tracker.name}.torrent`;
  const torrentPath = path.join(outputDir, torrentFileName);

  // Get all files in the release directory
  let allFiles = await getAllFiles(releaseDir);

  // Filter files based on disc types if specified
  if (includeDiscTypes && discs.length > 0) {
    // Get paths of discs to include (normalize path separators)
    const includedDiscPaths = new Set(
      discs.filter((disc) => includeDiscTypes.includes(disc.type)).map((disc) => path.normalize(disc.path)),
    );

    // Only include files that are within the included disc paths
    allFiles = allFiles.filter((file) => {
      const normalizedFile = path.normalize(file);
      return Array.from(includedDiscPaths).some((discPath) => {
        // Check if file is within this disc path
        return normalizedFile.startsWith(discPath + path.sep) || normalizedFile === discPath;
      });
    });
  } else if (includeDiscTypes === undefined && discs.length > 0) {
    // If no includeDiscTypes specified but we have discs, exclude BD/DVD/photobook discs
    const excludedDiscPaths = new Set(
      discs
        .filter((disc) => disc.type === "bd" || disc.type === "dvd" || disc.type === "photobook")
        .map((disc) => path.normalize(disc.path)),
    );

    // Exclude files that are within the excluded disc paths
    allFiles = allFiles.filter((file) => {
      const normalizedFile = path.normalize(file);
      return !Array.from(excludedDiscPaths).some((discPath) => {
        return normalizedFile.startsWith(discPath + path.sep) || normalizedFile === discPath;
      });
    });
  }

  // Filter out excluded files based on tracker configuration
  if (tracker.excludeFilePatterns && tracker.excludeFilePatterns.length > 0) {
    allFiles = allFiles.filter((file) => !matchesPattern(file, tracker.excludeFilePatterns!));
  }

  // Stat all files to get their sizes and calculate total size
  const fileStats = await Promise.all(
    allFiles.map(async (filePath) => {
      const stats = await fs.promises.stat(filePath);
      return { path: filePath, size: stats.size };
    }),
  );

  const totalSize = fileStats.reduce((sum, file) => sum + file.size, 0);

  // Calculate optimal piece length based on total size
  const pieceLength = calculatePieceLength(totalSize);

  // Create file list with paths relative to release directory
  const fileList = allFiles.map((filePath) => {
    const stream = fs.createReadStream(filePath);
    // Add name property for create-torrent
    // Convert Windows backslashes to forward slashes for torrent format
    const relativePath = path.relative(releaseDir, filePath);
    (stream as { name?: string }).name = relativePath.replace(/\\/g, "/");
    return stream;
  });

  // Create torrent options
  const torrentOptions: Parameters<typeof createTorrent>[1] = {
    name: releaseName,
    private: true,
    announceList: [[tracker.tracker]],
    pieceLength: pieceLength,
    info: tracker.source ? { source: tracker.source } : undefined,
    createdBy: "maoam-torrent-packer/1.0.0",
  };

  // Create the torrent
  const torrentBuffer = await new Promise<Buffer>((resolve, reject) => {
    createTorrent(fileList, torrentOptions, (err, torrent) => {
      if (err) reject(err);
      else resolve(torrent);
    });
  });

  // Write torrent file
  await fs.promises.writeFile(torrentPath, torrentBuffer);

  return torrentPath;
}

/**
 * Create torrents for all applicable formats of a release
 */
export async function createTorrentsForRelease(
  releasePaths: {
    flac?: string;
    flac24?: string;
    mp3_320?: string;
    mp3_v0?: string;
    bluray?: string;
    dvd?: string;
    photobook?: string;
  },
  trackers: TrackerConfig[],
  torrentOutputDir: string,
  discs: DiscInfo[] = [],
): Promise<void> {
  const { flac, flac24, mp3_320, mp3_v0, bluray, dvd, photobook } = releasePaths;

  for (const tracker of trackers) {
    console.log(chalkTemplate`  {blue →} Creating torrents for tracker: ${tracker.name}`);

    // Create FLAC torrent if available
    if (flac) {
      const torrentPath = await createTorrentFile({
        releaseDir: flac,
        outputDir: torrentOutputDir,
        tracker,
        discs,
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create FLAC-24 torrent if available
    if (flac24) {
      const torrentPath = await createTorrentFile({
        releaseDir: flac24,
        outputDir: torrentOutputDir,
        tracker,
        discs,
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create 320 torrent if available and tracker allows it
    if (mp3_320 && !tracker.no320) {
      const torrentPath = await createTorrentFile({
        releaseDir: mp3_320,
        outputDir: torrentOutputDir,
        tracker,
        discs,
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create V0 torrent if available
    if (mp3_v0) {
      const torrentPath = await createTorrentFile({
        releaseDir: mp3_v0,
        outputDir: torrentOutputDir,
        tracker,
        discs,
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create Blu-ray torrent if available and tracker allows it
    if (bluray && tracker.outputBluray) {
      const torrentPath = await createTorrentFile({
        releaseDir: bluray,
        outputDir: torrentOutputDir,
        tracker,
        suffix: "bd",
        discs,
        includeDiscTypes: ["bd"],
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create DVD torrent if available and tracker allows it
    if (dvd && tracker.outputDVD) {
      const torrentPath = await createTorrentFile({
        releaseDir: dvd,
        outputDir: torrentOutputDir,
        tracker,
        suffix: "dvd",
        discs,
        includeDiscTypes: ["dvd"],
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }

    // Create photobook torrent if available and tracker allows it
    if (photobook && tracker.outputPhotobook) {
      const torrentPath = await createTorrentFile({
        releaseDir: photobook,
        outputDir: torrentOutputDir,
        tracker,
        suffix: "photobook",
        discs,
        includeDiscTypes: ["photobook"],
      });
      console.log(chalkTemplate`    {green ✓} Created: ${path.basename(torrentPath)}`);
    }
  }
}
