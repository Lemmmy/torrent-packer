import * as path from "node:path";
import { parseReleaseDirectory } from "./release-parser.ts";
import { findFiles } from "./file-utils.ts";
import { getAudioFileInfo } from "./audio-test.ts";
import { readFlacMetadata } from "./metadata.ts";

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

export async function generateTracklistBBCode(releaseDir: string, forceType?: "cd" | "bd" | "dvd"): Promise<string> {
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

      let line = "";
      if (i === 0) {
        line += "[size=2" + "]";
      }

      line += `[b]${trackNumberStr}[/b]. ${track.title} [i][${durationStr}][/i]`;

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

        let line = "";
        if (i === 0) {
          line += "[size=2" + "]";
        }

        line += `[b]${trackNumberStr}[/b]. ${track.title} [i][${durationStr}][/i]`;

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
