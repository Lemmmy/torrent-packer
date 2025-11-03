import * as path from "node:path";
import type { ReleaseInfo } from "./types.ts";

/**
 * Parse a release directory name to extract format information
 * Examples:
 * - [FLAC] -> format: FLAC, is24Bit: false
 * - [FLAC-24] -> format: FLAC, is24Bit: true
 * - [FLAC-24-48] -> format: FLAC, is24Bit: true
 * - [CD-FLAC] -> format: FLAC, is24Bit: false
 * - [WEB-320] -> format: 320, is24Bit: false
 * - [320] -> format: 320, is24Bit: false
 */
export function parseReleaseDirectory(dirPath: string): ReleaseInfo {
  const basename = path.basename(dirPath);

  // Extract format tag from the end of the directory name
  const formatMatch = basename.match(/\[([^\]]+)\]$/);

  if (!formatMatch) {
    throw new Error(`Could not parse format from directory name: ${basename}`);
  }

  const formatTag = formatMatch[1];

  // Determine if it's 24-bit
  const is24Bit = /24/.test(formatTag);

  // Determine the base format
  let format: string;
  let hasMP3 = false;

  if (/FLAC/i.test(formatTag)) {
    format = "FLAC";
  } else if (/320/.test(formatTag)) {
    format = "320";
    hasMP3 = true;
  } else if (/V0/.test(formatTag)) {
    format = "V0";
    hasMP3 = true;
  } else {
    format = formatTag;
  }

  return {
    path: dirPath,
    basename,
    format,
    is24Bit,
    hasMP3,
  };
}

/**
 * Replace the format tag in a release directory name
 * Preserves media designation (CD-, WEB-, etc.) if present
 */
export function replaceFormatTag(dirName: string, newFormatTag: string): string {
  const formatMatch = dirName.match(/\[([^\]]+)\]$/);
  if (!formatMatch) {
    return dirName;
  }

  const currentTag = formatMatch[1];

  // Check if there's a media designation prefix (e.g., CD-, WEB-, CDr-)
  const mediaMatch = currentTag.match(/^([A-Za-z]+r?)-/);

  if (mediaMatch) {
    // Preserve the media designation
    const mediaPrefix = mediaMatch[1];
    return dirName.replace(/\[([^\]]+)\]$/, `[${mediaPrefix}-${newFormatTag}]`);
  }

  // No media designation, just replace the format
  return dirName.replace(/\[([^\]]+)\]$/, `[${newFormatTag}]`);
}

/**
 * Check if a directory name contains a bitrate indicator in the format tag
 */
export function hasBitrateInFormatTag(dirName: string): boolean {
  const formatMatch = dirName.match(/\[([^\]]+)\]$/);
  if (!formatMatch) return false;

  const formatTag = formatMatch[1];

  // Check for patterns like FLAC-24, FLAC-24-48, etc.
  return /FLAC-\d+/.test(formatTag);
}
