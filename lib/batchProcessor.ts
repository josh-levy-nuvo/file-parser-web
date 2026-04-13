import JSZip from "jszip";

export const BATCH_SIZE = 30;

export interface FileEntry {
  name: string;
  data: string; // base64
}

export interface TabRename {
  from: string;
  to: string;
}

export interface FileResult {
  file: string;
  tabs_before: string[];
  tabs_kept: string[];
  tabs_removed: string[];
  tabs_renamed: TabRename[];
  status: "ok" | "skipped" | "error";
  note: string;
  cleaned_data?: string; // base64, full run only
}

export interface BatchProgress {
  batchIndex: number;
  totalBatches: number;
  filesProcessed: number;
  totalFiles: number;
}

/** Extract all .xlsx files from a zip as base64 FileEntry array */
export async function extractZip(zipFile: File): Promise<FileEntry[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const entries: FileEntry[] = [];
  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.toLowerCase().endsWith(".xlsx")) {
      const name = relativePath.split("/").pop() || relativePath;
      promises.push(
        zipEntry.async("base64").then((data) => {
          entries.push({ name, data });
        })
      );
    }
  });

  await Promise.all(promises);
  return entries;
}

/** Split array into chunks of size n */
export function chunk<T>(arr: T[], n: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    chunks.push(arr.slice(i, i + n));
  }
  return chunks;
}

/** Call /api/batch for a single batch */
async function callBatch(
  files: FileEntry[],
  benefits: string[],
  dryRun: boolean
): Promise<FileResult[]> {
  const res = await fetch("/api/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, benefits, dry_run: dryRun }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.results as FileResult[];
}

/** Run all batches sequentially, calling onProgress after each */
export async function processBatches(
  files: FileEntry[],
  benefits: string[],
  dryRun: boolean,
  onProgress: (progress: BatchProgress) => void
): Promise<FileResult[]> {
  const batches = chunk(files, BATCH_SIZE);
  const allResults: FileResult[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batchResults = await callBatch(batches[i], benefits, dryRun);
    allResults.push(...batchResults);
    onProgress({
      batchIndex: i + 1,
      totalBatches: batches.length,
      filesProcessed: allResults.length,
      totalFiles: files.length,
    });
  }

  return allResults;
}

/** Assemble cleaned files into a downloadable zip (full run only) */
export async function assembleZip(results: FileResult[]): Promise<Blob> {
  const zip = new JSZip();
  for (const r of results) {
    if (r.status === "ok" && r.cleaned_data) {
      zip.file(r.file, r.cleaned_data, { base64: true });
    }
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** Build audit log string client-side */
export function buildAuditLog(
  results: FileResult[],
  benefits: string[],
  dryRun: boolean,
  startTime: Date,
  endTime: Date
): string {
  const sep = (c = "-") => c.repeat(80);
  const duration = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2);
  const ok      = results.filter((r) => r.status === "ok");
  const skipped = results.filter((r) => r.status === "skipped");
  const errors  = results.filter((r) => r.status === "error");
  const mode    = dryRun ? "DRY RUN - NO FILES WRITTEN" : "AUDIT LOG";
  const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

  const lines: string[] = [
    sep("="),
    `  FILE PARSER - ${mode}`,
    sep("="),
    `  Run started : ${fmt(startTime)}`,
    `  Run ended   : ${fmt(endTime)}`,
    `  Duration    : ${duration}s`,
    `  Total files : ${results.length}`,
    `  ${dryRun ? "Would clean" : "Cleaned"}     : ${ok.length}`,
    `  Skipped     : ${skipped.length}  (no matching tabs)`,
    `  Errors      : ${errors.length}`,
    "",
    `  Benefits kept  : ${benefits.join(", ")}`,
    `  Output zip     : ${dryRun ? "(dry run - not created)" : "cleaned.zip"}`,
    sep("="),
    "",
    "PRE-RUN INVENTORY",
    sep(),
  ];

  for (const r of results) {
    const tabs = r.tabs_before.map((t) => `"${t}"`).join(", ") || "(none)";
    lines.push(`  ${r.file}`);
    lines.push(`    Tabs: ${tabs}`);
  }
  lines.push("");
  lines.push("ACTIONS PER FILE");
  lines.push(sep());

  for (const r of results) {
    const label = { ok: "CLEANED", skipped: "SKIPPED", error: "ERROR" }[r.status];
    lines.push(`  [${label}] ${r.file}`);
    if (r.tabs_kept.length)    lines.push(`    Kept    : ${r.tabs_kept.map((t) => `'${t}'`).join(", ")}`);
    if (r.tabs_removed.length) lines.push(`    Removed : ${r.tabs_removed.map((t) => `'${t}'`).join(", ")}`);
    for (const rn of r.tabs_renamed) {
      lines.push(`    Renamed : '${rn.from}' -> '${rn.to}'  (whitespace stripped)`);
    }
    if (r.note) lines.push(`    Note    : ${r.note}`);
    lines.push("");
  }

  lines.push("POST-RUN SUMMARY");
  lines.push(sep());
  lines.push(`  ${dryRun ? "Files that would be written to zip" : "Files written to zip"} : ${ok.length}`);
  if (skipped.length) {
    lines.push("  Skipped files (no matching tabs):");
    skipped.forEach((r) => lines.push(`    - ${r.file}`));
  }
  if (errors.length) {
    lines.push("  Errors:");
    errors.forEach((r) => lines.push(`    - ${r.file} : ${r.note}`));
  }
  lines.push(sep("="));

  return lines.join("\n");
}

/** Trigger browser download of a Blob */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
