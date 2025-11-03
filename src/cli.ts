import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export interface CliOptions {
  trackers?: string[];
  noMove?: boolean;
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
    .help()
    .alias("help", "h")
    .parseSync();

  return {
    trackers: argv.trackers as string[] | undefined,
    noMove: argv["no-move"] as boolean,
  };
}
