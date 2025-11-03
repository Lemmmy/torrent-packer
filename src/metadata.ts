import { parseFile } from "music-metadata";
import type { FlacMetadata } from "./types.ts";

/**
 * Read FLAC metadata tags using music-metadata library
 */
export async function readFlacMetadata(filePath: string): Promise<FlacMetadata> {
  const metadata = await parseFile(filePath);

  const tags: FlacMetadata = {};

  if (metadata.common.title) {
    tags.TITLE = metadata.common.title;
  }

  if (metadata.common.album) {
    tags.ALBUM = metadata.common.album;
  }

  if (metadata.common.artist) {
    tags.ARTIST = metadata.common.artist;
  }

  if (metadata.common.albumartist) {
    tags.ALBUMARTIST = metadata.common.albumartist;
  }

  // Track number - zero-padded
  if (metadata.common.track.no !== null && metadata.common.track.no !== undefined) {
    const trackNum = metadata.common.track.no.toString();
    tags.TRACKNUMBER = trackNum.length === 1 ? `0${trackNum}` : trackNum;
  }

  // Disc number - zero-padded
  if (metadata.common.disk.no !== null && metadata.common.disk.no !== undefined) {
    const discNum = metadata.common.disk.no.toString();
    tags.DISCNUMBER = discNum.length === 1 ? `0${discNum}` : discNum;
  }

  if (metadata.common.year) {
    tags.YEAR = metadata.common.year.toString();
  }

  if (metadata.common.date) {
    tags.DATE = metadata.common.date;
  }

  if (metadata.common.genre && metadata.common.genre.length > 0) {
    tags.GENRE = metadata.common.genre.join(", ");
  }

  if (metadata.common.comment && metadata.common.comment.length > 0) {
    // Comment can be an array of strings or objects with text property
    tags.COMMENT = metadata.common.comment
      .map((c) => (typeof c === "string" ? c : c.text || ""))
      .filter((c) => c.length > 0)
      .join("; ");
  }

  // Additional tags from native FLAC tags
  if (metadata.native && metadata.native.vorbis) {
    for (const tag of metadata.native.vorbis) {
      if (tag.id === "CATALOGNUMBER" && typeof tag.value === "string") {
        tags.CATALOGNUMBER = tag.value;
      } else if (tag.id === "BARCODE" && typeof tag.value === "string") {
        tags.BARCODE = tag.value;
      }
    }
  }

  return tags;
}

/**
 * Build LAME tag arguments from FLAC metadata
 * Maps FLAC tags to ID3v2 frames
 */
export function buildLameTagArgs(metadata: FlacMetadata): string[] {
  const args: string[] = [];

  // TIT2 - Title
  if (metadata.TITLE) {
    args.push("--tt", metadata.TITLE);
  }

  // TALB - Album
  if (metadata.ALBUM) {
    args.push("--tl", metadata.ALBUM);
  }

  // TPE1 - Artist
  if (metadata.ARTIST) {
    args.push("--ta", metadata.ARTIST);
  }

  // TPE2 - Album Artist
  if (metadata.ALBUMARTIST) {
    args.push("--tv", `TPE2=${metadata.ALBUMARTIST}`);
  }

  // TRCK - Track number (zero-padded)
  if (metadata.TRACKNUMBER) {
    args.push("--tv", `TRCK=${metadata.TRACKNUMBER}`);
  }

  // TPOS - Disc number (zero-padded)
  if (metadata.DISCNUMBER) {
    args.push("--tv", `TPOS=${metadata.DISCNUMBER}`);
  }

  // TCON - Genre
  if (metadata.GENRE) {
    args.push("--tg", metadata.GENRE);
  }

  // TYER - Year (ID3v2.3)
  if (metadata.YEAR) {
    args.push("--tv", `TYER=${metadata.YEAR}`);
  }

  // TDRC - Recording date (ID3v2.4)
  // if (metadata.DATE) {
  //   args.push("--tv", `TDRC=${metadata.DATE}`);
  // }

  // COMM - Comment
  if (metadata.COMMENT) {
    args.push("--tc", metadata.COMMENT);
  }

  // TXXX:CATALOGNUMBER - Catalog number (user-defined text frame)
  if (metadata.CATALOGNUMBER) {
    args.push("--tv", `TXXX=CATALOGNUMBER=${metadata.CATALOGNUMBER}`);
  }

  // TXXX:BARCODE - Barcode (user-defined text frame)
  if (metadata.BARCODE) {
    args.push("--tv", `TXXX=BARCODE=${metadata.BARCODE}`);
  }

  return args;
}
