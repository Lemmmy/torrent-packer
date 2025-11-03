import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "./env.ts";
import { buildExecSpec } from "./utils.ts";
import type { AudioFileInfo } from "./types.ts";

const execFileAsync = promisify(execFile);

/**
 * Test a FLAC file for integrity using `flac -t`
 */
export async function testFlacFile(filePath: string): Promise<void> {
  const { stdout, stderr } = await execFileAsync(env.FLAC_PATH, ["-t", filePath], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  const combined = [stdout, stderr].filter(Boolean).join("\n");

  // Check for errors in the output
  if (combined.includes("ERROR") || combined.includes("FAILED")) {
    throw new Error(`FLAC test failed for ${filePath}: ${combined}`);
  }
}

/**
 * Get audio file information (channels and duration) using ffprobe
 */
export async function getAudioFileInfo(filePath: string): Promise<AudioFileInfo> {
  const { stdout } = await execFileAsync(
    env.FFPROBE_PATH,
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=channels:format=duration",
      "-of",
      "default=noprint_wrappers=1",
      filePath,
    ],
    {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  const lines = stdout.trim().split(/\r?\n/);
  let channels = 0;
  let duration = 0;

  for (const line of lines) {
    if (line.startsWith("channels=")) {
      channels = parseInt(line.substring("channels=".length), 10);
    } else if (line.startsWith("duration=")) {
      duration = parseFloat(line.substring("duration=".length));
    }
  }

  if (channels === 0 || duration === 0) {
    throw new Error(`Failed to get audio info for ${filePath}`);
  }

  return { path: filePath, channels, duration };
}

/**
 * Validate that an audio file has a sane channel count (1 or 2 channels)
 */
export function validateChannelCount(info: AudioFileInfo): void {
  if (info.channels > 2) {
    throw new Error(`File ${info.path} has ${info.channels} channels (expected 1 or 2)`);
  }
}

/**
 * Get the bit depth of a FLAC file using metaflac
 */
export async function getFlacBitDepth(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(env.METAFLAC_PATH, ["--show-bps", filePath], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  const bitDepth = parseInt(stdout.trim(), 10);
  if (isNaN(bitDepth)) {
    throw new Error(`Failed to get bit depth for ${filePath}`);
  }

  return bitDepth;
}
