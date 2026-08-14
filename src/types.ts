/**
 * Shared types for the dsh-openwolf code-map engine.
 *
 * The scanner produces a {@link CodeMap}: a compact, pre-indexed view of a
 * workspace (file tree + per-file one-line summaries + top symbols) meant to
 * replace repeated whole-file reads in agent context.
 *
 * @module dsh-openwolf/types
 */

/** One scanned file entry inside a {@link CodeMap}. */
export interface FileEntry {
  /** Workspace-relative POSIX path (e.g. `src/index.ts`). */
  path: string
  /** Size in bytes. */
  size: number
  /** Number of lines (newline count). */
  lines: number
  /** Extracted top-level symbols (bounded by the scanner). */
  symbols: string[]
  /** Symbol hits with 1-based start lines (bounded), for offset/limit hints. */
  symbolLines?: SymbolLine[]
  /** One-line summary: the first meaningful line of the file. */
  summary: string
  /** Short language tag (`ts`, `py`, `go`, `text`, `binary`, ...). */
  lang: string
  /** Estimated tokens (char-ratio heuristic). */
  tokens: number
  /** File mtime (epoch ms) at scan time — hint staleness check. */
  mtimeMs?: number
  /** True when the file was too large to open (or binary). */
  skipped: boolean
}

/** A top-level symbol and the line where it starts. */
export interface SymbolLine {
  name: string
  line: number
  /** Last line of the declaration (offset/limit reads); lezer or enriched. */
  endLine?: number
  /** Estimated tokens of the declaration body. */
  tokens?: number
}

/** Symbol extraction backend. */
export type SymbolBackend = 'auto' | 'regex' | 'lezer'

/** Aggregated counts for one directory. */
export interface DirEntry {
  /** Workspace-relative POSIX directory path (`` for the root). */
  path: string
  /** Number of files directly or transitively inside the directory. */
  files: number
  /** Total lines across those files. */
  lines: number
  /** Total bytes across those files. */
  bytes: number
}

/** The compact map produced by {@link scanCodebase}. */
export interface CodeMap {
  /** Absolute workspace root that was scanned. */
  root: string
  /** Monotonic version; bumped on every rescan. */
  version: number
  /** Epoch ms of the scan. */
  scannedAt: number
  /** Files with full analysis, in scan order. */
  files: FileEntry[]
  /** Per-directory aggregates. */
  dirs: DirEntry[]
  /** Total scanned files. */
  totalFiles: number
  /** Total lines across scanned files. */
  totalLines: number
  /** Total bytes across scanned files. */
  totalBytes: number
  /** Files skipped because the scan budget (maxFiles) was exhausted. */
  skippedFiles: number
  /** True when the scan stopped early because of the maxFiles cap. */
  truncated: boolean
  /** Scan wall time in ms. */
  elapsedMs: number
}

/** On-demand digest for one file, produced by {@link summarizeFile}. */
export interface FileDigest {
  /** Workspace-relative POSIX path. */
  path: string
  /** Whether the file exists under the workspace root. */
  exists: boolean
  /** Size in bytes when the file exists. */
  size?: number
  /** Line count when the file exists. */
  lines?: number
  /** Detected language tag. */
  lang?: string
  /** Extracted top-level symbols. */
  symbols?: string[]
  /** Head preview of the file content (bounded). */
  preview?: string
  /** True when the preview was truncated at the byte budget. */
  previewTruncated?: boolean
}

/** Options controlling one {@link scanCodebase} run. */
export interface ScanOptions {
  /** Hard cap on scanned files; scanning stops early when reached. */
  maxFiles: number
  /** Files larger than this are listed but not opened. */
  maxFileBytes: number
  /** Extract top-level symbols. */
  symbols: boolean
  /** Symbol backend: `auto` (lezer when available) | `regex` | `lezer`. */
  symbolBackend: SymbolBackend
  /** Include dot-files and dot-directories (`.git` is always excluded). */
  hidden: boolean
  /** Extra ignore patterns (gitignore-lite syntax). */
  extraIgnore: string[]
  /** Also honor the workspace `.gitignore` (root level). */
  useGitignore: boolean
  /** Sort files by `path` (ascending) or `size` (descending). */
  sortBy: 'path' | 'size'
}
