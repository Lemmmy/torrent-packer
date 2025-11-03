export interface TrackerConfig {
  name: string;
  tracker: string;
  source?: string;
  default?: boolean;
  no320?: boolean;
  excludeFilePatterns?: string[];
}

export interface TrackersConfig {
  [key: string]: TrackerConfig;
}

export interface ReleaseInfo {
  path: string;
  basename: string;
  format: string;
  bitDepth?: number;
  is24Bit: boolean;
  hasMP3: boolean;
}

export interface AudioFileInfo {
  path: string;
  channels: number;
  duration: number;
}

export interface FlacMetadata {
  TITLE?: string;
  ARTIST?: string;
  ALBUM?: string;
  ALBUMARTIST?: string;
  TRACKNUMBER?: string;
  DISCNUMBER?: string;
  YEAR?: string;
  DATE?: string;
  GENRE?: string;
  COMMENT?: string;
  CATALOGNUMBER?: string;
  BARCODE?: string;
  [key: string]: string | undefined;
}
