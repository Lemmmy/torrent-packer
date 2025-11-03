import * as path from "node:path";
import chalkTemplate from "chalk-template";
import PQueue from "p-queue";
import { getAudioFileInfo } from "./audio-test.ts";
import { findFiles } from "./file-utils.ts";

const DURATION_TOLERANCE = 1.0; // seconds

/**
 * Validate that transcoded MP3 files have matching durations to source FLAC files
 */
export async function validateTranscodedDurations(
  mp3Dir: string,
  flacDurations: Map<string, number>,
  queue: PQueue,
): Promise<void> {
  const mp3Files = await findFiles(mp3Dir, /\.mp3$/i);

  if (mp3Files.length === 0) {
    return;
  }

  console.log(chalkTemplate`  {blue →} Validating durations of ${mp3Files.length} MP3 files...`);

  const errors: string[] = [];

  await Promise.all(
    mp3Files.map((mp3File) =>
      queue.add(async () => {
        const mp3RelativePath = path.relative(mp3Dir, mp3File);
        const flacRelativePath = mp3RelativePath.replace(/\.mp3$/i, ".flac");

        const expectedDuration = flacDurations.get(flacRelativePath);

        if (expectedDuration === undefined) {
          // This shouldn't happen, but log it just in case
          console.warn(chalkTemplate`  {yellow ⚠} No FLAC duration found for: ${mp3RelativePath}`);
          return;
        }

        const mp3Info = await getAudioFileInfo(mp3File);
        const durationDiff = Math.abs(mp3Info.duration - expectedDuration);

        if (durationDiff > DURATION_TOLERANCE) {
          const errorMsg = chalkTemplate`${path.basename(mp3File)}: Expected ${expectedDuration.toFixed(2)}s, got ${mp3Info.duration.toFixed(2)}s (diff: ${durationDiff.toFixed(2)}s)`;
          errors.push(errorMsg);
        }
      }),
    ),
  );

  if (errors.length > 0) {
    console.error(chalkTemplate`  {red ✗} Duration validation failed for ${errors.length} files:`);
    for (const error of errors) {
      console.error(chalkTemplate`    {red -} ${error}`);
    }
    throw new Error(
      `Transcoding duration validation failed: ${errors.length} files have duration mismatches > ${DURATION_TOLERANCE}s`,
    );
  }

  console.log(chalkTemplate`  {green ✓} All MP3 durations match FLAC sources (within ${DURATION_TOLERANCE}s)`);
}
