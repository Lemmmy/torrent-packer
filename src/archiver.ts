import chalkTemplate from "chalk-template";
import * as path from "node:path";
import { add } from "node-7z";
import sevenBin from "7zip-bin";

/**
 * Create a 7z archive in store mode (no compression) with a root folder
 * @param sourceDir - The directory to archive
 * @param outputDir - The directory where the archive should be saved
 * @returns The path to the created archive
 */
export async function create7zArchive(sourceDir: string, outputDir: string): Promise<string> {
  const basename = path.basename(sourceDir);
  const archivePath = path.join(outputDir, `${basename}.7z`);

  console.log(chalkTemplate`  {blue →} Creating 7z archive: ${basename}.7z`);

  // Create archive with store mode (no compression) and include root folder
  // We archive the parent directory but only include the target folder
  const parentDir = path.dirname(sourceDir);
  const stream = add(archivePath, basename, {
    $bin: sevenBin.path7za,
    method: ["x=0"], // Store mode (no compression)
    recursive: true,
    workingDir: parentDir, // Set working directory to parent so basename becomes the root folder
  });

  return new Promise((resolve, reject) => {
    stream.on("end", () => {
      console.log(chalkTemplate`  {green ✓} Archive created: ${basename}.7z`);
      resolve(archivePath);
    });

    stream.on("error", (err: Error) => {
      console.error(chalkTemplate`  {red ✗} Failed to create archive: ${err.message}`);
      reject(err);
    });
  });
}
