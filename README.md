# Torrent Packer

A personal tool for processing music releases and creating torrents. Automates validation, cleaning, transcoding, and
torrent creation for FLAC and MP3 releases. Replaces a combination of bash scripts based on
[whatmp3](https://github.com/RecursiveForest/whatmp3). Designed to run on Linux and Windows.

Unlike my old scripts, this one is entirely vibe coded and was hacked together in an hour. For that reason, I don't
really recommend using it—doing so would be entirely at your own risk. You are responsible for following the rules of
the trackers you use.

Everything below this point was written by an LLM.

## Features

### 1. Input Verification

- **FLAC Testing**: Validates FLAC file integrity using `flac -t`
- **Audio Validation**: Checks channel count and duration using `ffprobe`
- **Bitrate Validation**: Ensures 24-bit FLAC files are properly tagged in directory names
- **Log Checking**: Tests `.log` files using `hbcl` (heybrochecklog)
- **ID3 Tag Detection**: Warns if FLAC files use ID3 tags instead of Vorbis comments
- **Unicode Normalization**: Checks that all filenames, directory names, and FLAC tags are NFC normalized
- **Interactive Prompts**: Pauses before continuing if any verification warnings are detected

### 2. Input Cleaning

- **Cover Art Processing**:
  - Resizes single cover images to max 512x512
  - Renames to `cover.jpg`
  - Removes embedded covers from FLAC files and ensures there is exactly 4096 bytes of padding
- **File Cleanup**: Deletes `.m3u8` files
- **Cue File Renaming**: Matches `.cue` files to `.log` file basenames

### 3. Transcoding

- **MP3 320**: High-quality CBR encoding using LAME
- **MP3 V0**: High-quality VBR encoding using LAME
- **Metadata Preservation**: Reads FLAC tags using `music-metadata` and writes ID3v2 tags to MP3s
  - Supports: Title, Album, Artist, Track Number, Disc Number, Date, Genre, Comment
  - Handles UTF-8 and special characters correctly
- **24-bit Downsampling**: Converts 24-bit FLAC to 16-bit using SoX with high-quality resampling
  - Always downsamples to common multiples: 192/96 kHz → 48 kHz, 176.4/88.2 kHz → 44.1 kHz
  - Uses SoX with `-v -L` (very high quality, linear phase) and dithering
  - Adds 4096 bytes of padding to output files

### 4. Torrent Creation

- Creates torrents for multiple trackers from `trackers.json`
- Supports tracker-specific configurations:
  - `no320`: Skip 320 kbps torrents
  - `excludeFilePatterns`: Filter out specific files/folders (e.g., scans)
  - `source`: Set torrent source tag

## Configuration

### Environment Variables (`.env`)

```env
BASE_DIR=F:\torrent-processing-new
INPUT_DIR=        # Optional, defaults to BASE_DIR/input
OUTPUT_DIR=       # Optional, defaults to BASE_DIR/output
TORRENT_DIR=      # Optional, defaults to BASE_DIR/torrent
SPECTROGRAMS_DIR= # Optional, defaults to BASE_DIR/spectrograms

LAME_PATH=lame
FLAC_PATH=flac
METAFLAC_PATH=metaflac
SOX_PATH=sox_ng
FFPROBE_PATH=ffprobe
MEDIAINFO_PATH=mediainfo

HBCL_CMD="python -m heybrochecklog -ei \"%1\""
```

### Tracker Configuration (`trackers.json`)

```json
{
  "red": {
    "name": "red",
    "tracker": "https://...",
    "source": "RED",
    "default": true
  },
  "ab": {
    "name": "ab",
    "tracker": "https://...",
    "source": "...",
    "default": true,
    "no320": true,
    "excludeFilePatterns": ["Scans"]
  }
}
```

## Release Directory Format

Release directories must follow this naming convention:

```
[Date] Artist — Album {Catalog} [Format]
```

Examples:

- `[2016.12.14] 悠木碧 — トコワカノクニ {VTCL-60429} [CD-FLAC]`
- `[2020.01.15] Artist — Album {CAT-001} [FLAC-24-48]`
- `[2019.05.20] Artist — Album {CAT-002} [WEB-320]`

### Supported Format Tags

- **FLAC**: `[FLAC]`, `[CD-FLAC]`, `[WEB-FLAC]`, `[CDr-FLAC]`
- **24-bit FLAC**: `[FLAC-24]`, `[FLAC-24-48]`, `[CD-FLAC-24]`
- **MP3**: `[320]`, `[V0]`, `[WEB-320]`, `[WEB-V0]`

## Workflow

1. **Scan** `INPUT_DIR` for release directories
2. **Validate** FLAC files, audio files, and log files
3. **Clean** cover art, remove embedded images, delete m3u8 files
4. **Transcode** to MP3 320 and V0 (if source is FLAC)
5. **Create torrents** for each tracker and format combination

## Usage

```bash
# Process all releases in INPUT_DIR
pnpm run

# Run with specific trackers
pnpm run -- -t red ops

# Run with a single tracker
pnpm run -- -t ops

# Archive all working directories to a dated folder
pnpm run archive
```

### Archiving

The archive command moves all contents from the working directories to a dated archive folder:

```bash
pnpm run archive
```

This will move everything from:

- `INPUT_DIR` → `BASE_DIR/archive-YYYY-MM-DD/input`
- `OUTPUT_DIR` → `BASE_DIR/archive-YYYY-MM-DD/output`
- `TORRENT_DIR` → `BASE_DIR/archive-YYYY-MM-DD/torrent`
- `SPECTROGRAMS_DIR` → `BASE_DIR/archive-YYYY-MM-DD/spectrograms`

This is useful for cleaning up after processing batches of releases while keeping everything organized by date.

### Command-Line Options

- `--trackers, -t`: Specify which trackers to use (space-separated list)
  - If not specified, uses all trackers with `default: true` in `trackers.json`
  - Example: `--trackers red ab jps`
- `--no-move`: Don't move input files to output directory after processing
  - By default, input files are moved to output after successful processing
  - Use this flag to keep input files in place

### Verification Warnings

The tool will display prominent warnings for:

- **Mixed bit depth releases**: When a release contains both 16-bit and 24-bit FLAC files
- **ID3 tags in FLAC files**: When FLAC files use ID3 tags instead of proper Vorbis comments
- **Non-NFC normalized Unicode**: When filenames, directories, or FLAC tags contain non-normalized Unicode

When any verification warning is detected, the tool will pause and ask for confirmation before continuing with that release.

### Spectrogram Generation

Automatically generates spectrograms for all FLAC files in the background:

- **Full spectrogram**: 3000x513 pixels showing the entire track
- **Zoom spectrogram**: 500x1025 pixels showing a 2-second window at 1 minute
- Spectrograms are saved to `SPECTROGRAMS_DIR` maintaining the release directory structure
- Generation runs in parallel with other processing and completes before files are moved

### Smart Transcoding

- If all enabled trackers have the `no320` flag set, the tool will automatically skip 320 kbps transcoding entirely
- Duration validation ensures all transcoded MP3 files match their source FLAC files within 1 second
  - Mismatches greater than 1 second are treated as fatal errors

## External Tools Required

- **lame**: MP3 encoding
- **flac**: FLAC testing
- **metaflac**: FLAC metadata manipulation and padding
- **sox**: High-quality audio resampling for 24-bit to 16-bit conversion
- **ffprobe**: Audio file analysis
- **Python + heybrochecklog**: Log file validation
