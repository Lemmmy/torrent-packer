import * as fs from "node:fs/promises";
import * as path from "node:path";
import chalkTemplate from "chalk-template";
import { env } from "./env.ts";
import { printInfo, printSuccess } from "./warning-utils.ts";

/**
 * Archive all working directories to a dated archive folder
 */
async function archive() {
  printInfo("Torrent Packer - Archive Tool", []);

  // Generate archive directory name with current date
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const archiveDir = path.join(env.BASE_DIR, `archive-${dateStr}`);

  console.log(chalkTemplate`{bold Archiving to:} {cyan ${archiveDir}}\n`);

  // Create archive directory structure
  const archiveDirs = {
    input: path.join(archiveDir, "input"),
    output: path.join(archiveDir, "output"),
    torrent: path.join(archiveDir, "torrent"),
    spectrograms: path.join(archiveDir, "spectrograms"),
  };

  for (const dir of Object.values(archiveDirs)) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Move contents of each directory
  const moves = [
    { source: env.INPUT_DIR, dest: archiveDirs.input, name: "Input" },
    { source: env.OUTPUT_DIR, dest: archiveDirs.output, name: "Output" },
    { source: env.TORRENT_DIR, dest: archiveDirs.torrent, name: "Torrent" },
    { source: env.SPECTROGRAMS_DIR, dest: archiveDirs.spectrograms, name: "Spectrograms" },
  ];

  for (const { source, dest, name } of moves) {
    try {
      const entries = await fs.readdir(source, { withFileTypes: true });

      if (entries.length === 0) {
        console.log(chalkTemplate`  {gray ${name}: No files to archive}`);
        continue;
      }

      let movedCount = 0;
      for (const entry of entries) {
        const sourcePath = path.join(source, entry.name);
        const destPath = path.join(dest, entry.name);

        try {
          await fs.rename(sourcePath, destPath);
          movedCount++;
        } catch (error) {
          console.warn(chalkTemplate`  {yellow ⚠} Failed to move ${entry.name}: ${error}`);
        }
      }

      console.log(chalkTemplate`  {green ✓} ${name}: Moved ${movedCount} item(s)`);
    } catch (error) {
      console.warn(chalkTemplate`  {yellow ⚠} ${name}: ${error}`);
    }
  }

  printSuccess("Archive completed!", [`All files moved to: ${archiveDir}`]);
}

archive().catch((error) => {
  console.error(chalkTemplate`{bold.red Error:} ${error.message}`);
  console.error(error);
  process.exit(1);
});
