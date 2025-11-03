import "dotenv/config";
import path from "path";
import { z } from "zod";
import os from "node:os";

export const env = z
  .object({
    // Base working directory
    BASE_DIR: z.string().default("data-base"),
    // Directory of input files
    INPUT_DIR: z.string().optional(),
    // Directory of transcoded files
    OUTPUT_DIR: z.string().optional(),
    // Directory of .torrent files
    TORRENT_DIR: z.string().optional(),
    // Directory of spectrograms
    SPECTROGRAMS_DIR: z.string().optional(),

    LAME_PATH: z.string().default("lame"),
    FLAC_PATH: z.string().default("flac"),
    METAFLAC_PATH: z.string().default("metaflac"),
    SOX_PATH: z.string().default("sox_ng"),
    FFPROBE_PATH: z.string().default("ffprobe"),
    MEDIAINFO_PATH: z.string().default("mediainfo"),

    // Command to execute to run hbcl
    HBCL_CMD: z.string().default('python -m heybrochecklog -ei "%1"'),
    // TODO: integrate OPS logchecker somehow too

    CONCURRENCY_LIMIT: z
      .string()
      .default(os.cpus().length.toString())
      .transform((value) => parseInt(value)),
  })
  .transform((env) => {
    return {
      ...env,
      INPUT_DIR: env.INPUT_DIR || path.join(env.BASE_DIR, "input"),
      OUTPUT_DIR: env.OUTPUT_DIR || path.join(env.BASE_DIR, "output"),
      TORRENT_DIR: env.TORRENT_DIR || path.join(env.BASE_DIR, "torrent"),
      SPECTROGRAMS_DIR: env.SPECTROGRAMS_DIR || path.join(env.BASE_DIR, "spectrograms"),
    };
  })
  .parse(process.env);
