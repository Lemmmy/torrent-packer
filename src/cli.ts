import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliOptions {
  trackers?: string[];
  noMove?: boolean;
  inputDir?: string;
  outputDir?: string;
  torrentDir?: string;
  spectrogramsDir?: string;
  releasePath?: string;
  forceReleaseType?: "cd" | "bd" | "dvd";
  tracklistOnly?: boolean;
}

/**
 * Parse command-line arguments
 */
export function parseCliArgs(): CliOptions {
  const argv = yargs(hideBin(process.argv))
    .option("trackers", {
      alias: "t",
      type: "array",
      description: "Specify which trackers to use (e.g., --trackers red ab)",
      string: true,
    })
    .option("no-move", {
      type: "boolean",
      description: "Don't move input files to output directory after processing",
      default: false,
    })
    .option("input-dir", {
      alias: "i",
      type: "string",
      description: "Input directory (overrides INPUT_DIR env var)",
    })
    .option("output-dir", {
      alias: "o",
      type: "string",
      description: "Output directory (overrides OUTPUT_DIR env var)",
    })
    .option("torrent-dir", {
      type: "string",
      description: "Torrent output directory (overrides TORRENT_DIR env var)",
    })
    .option("spectrograms-dir", {
      type: "string",
      description: "Spectrograms directory (overrides SPECTROGRAMS_DIR env var)",
    })
    .option("release", {
      alias: "r",
      type: "string",
      description: "Process a single release directory (full path)",
    })
    .option("force-type", {
      type: "string",
      choices: ["cd", "bd", "dvd"],
      description: "Force release type detection (for non-disc-folder releases)",
    })
    .option("tracklist", {
      type: "boolean",
      description: "Print BBCode tracklist for the specified --release directory and exit",
      default: false,
    })
    .help()
    .alias("help", "h")
    .parseSync();

  return {
    trackers: argv.trackers as string[] | undefined,
    noMove: argv["dont-move"] as boolean,
    inputDir: argv["input-dir"] as string | undefined,
    outputDir: argv["output-dir"] as string | undefined,
    torrentDir: argv["torrent-dir"] as string | undefined,
    spectrogramsDir: argv["spectrograms-dir"] as string | undefined,
    releasePath: argv.release as string | undefined,
    forceReleaseType: argv["force-type"] as "cd" | "bd" | "dvd" | undefined,
    tracklistOnly: argv.tracklist as boolean,
  };
}
