import * as fs from "node:fs/promises";
import chalkTemplate from "chalk-template";
import { env } from "./env.ts";
import { scanInputDirectory, loadTrackers, processRelease, shouldSkip320 } from "./workflow.ts";
import { parseCliArgs } from "./cli.ts";
import { printInfo, printSuccess } from "./warning-utils.ts";

async function main() {
  printInfo("Torrent Packer - Music Release Processor", []);

  // Parse CLI arguments
  const cliOptions = parseCliArgs();

  // Ensure output directories exist
  await fs.mkdir(env.INPUT_DIR, { recursive: true });
  await fs.mkdir(env.OUTPUT_DIR, { recursive: true });
  await fs.mkdir(env.TORRENT_DIR, { recursive: true });
  await fs.mkdir(env.SPECTROGRAMS_DIR, { recursive: true });

  console.log(chalkTemplate`{bold Configuration:}`);
  console.log(chalkTemplate`  Input:   {cyan ${env.INPUT_DIR}}`);
  console.log(chalkTemplate`  Output:  {cyan ${env.OUTPUT_DIR}}`);
  console.log(chalkTemplate`  Torrent: {cyan ${env.TORRENT_DIR}}`);
  console.log(chalkTemplate`  Spectrograms: {cyan ${env.SPECTROGRAMS_DIR}}\n`);

  // Load trackers
  const trackers = await loadTrackers(cliOptions.trackers);
  console.log(chalkTemplate`{bold Trackers:}`);
  for (const tracker of trackers) {
    const flags = [];
    if (tracker.no320) flags.push("no320");
    if (tracker.excludeFilePatterns) flags.push(`excludes: ${tracker.excludeFilePatterns.join(", ")}`);
    const flagsStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
    console.log(chalkTemplate`  {green ✓} ${tracker.name}${flagsStr}`);
  }
  console.log();

  // Check if we should skip 320 transcoding
  const skip320 = shouldSkip320(trackers);
  if (skip320) {
    console.log(chalkTemplate`{bold.yellow ℹ} All enabled trackers have no320 flag - skipping 320 transcoding\n`);
  }

  // Scan for releases
  const releases = await scanInputDirectory();

  if (releases.length === 0) {
    console.log(chalkTemplate`{yellow No releases found in INPUT_DIR}`);
    return;
  }

  console.log(chalkTemplate`{bold Found ${releases.length} release(s) to process}\n`);

  // Process each release
  for (const release of releases) {
    try {
      await processRelease(release, trackers, skip320, cliOptions.noMove);
    } catch (error) {
      console.error(chalkTemplate`{bold.red ✗ Error processing release:} ${release}`);
      console.error(error);
      console.log(); // Add spacing
    }
  }

  printSuccess("All releases processed!");
}

main().catch(console.error);
