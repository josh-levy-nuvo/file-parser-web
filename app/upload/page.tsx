"use client";

import { useState, useRef } from "react";
import {
  extractZip,
  processBatches,
  assembleZip,
  buildAuditLog,
  downloadBlob,
  FileResult,
  BatchProgress,
} from "@/lib/batchProcessor";

type Stage = "idle" | "extracting" | "dry_running" | "previewing" | "processing" | "done" | "error";

function fmt(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function StatusBadge({ status }: { status: FileResult["status"] }) {
  const styles = {
    ok:      "bg-green-900 text-green-300",
    skipped: "bg-yellow-900 text-yellow-300",
    error:   "bg-red-900 text-red-300",
  };
  const labels = { ok: "CLEANED", skipped: "SKIPPED", error: "ERROR" };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function UploadPage() {
  const [zipFile, setZipFile]         = useState<File | null>(null);
  const [benefits, setBenefits]       = useState("");
  const [stage, setStage]             = useState<Stage>("idle");
  const [progress, setProgress]       = useState<BatchProgress | null>(null);
  const [dryResults, setDryResults]   = useState<FileResult[]>([]);
  const [error, setError]             = useState("");
  const [startTime, setStartTime]     = useState<Date | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const benefitList = benefits
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  function handleZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setZipFile(f);
  }

  async function handleDryRun() {
    if (!zipFile || benefitList.length === 0) return;
    setError("");
    setStage("extracting");
    setStartTime(new Date());
    try {
      const files = await extractZip(zipFile);
      setStage("dry_running");
      const results = await processBatches(files, benefitList, true, (p) => setProgress(p));
      setDryResults(results);
      setStage("previewing");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("error");
    }
  }

  async function handleProceed() {
    if (!zipFile) return;
    setError("");
    setStage("extracting");
    const procStart = new Date();
    setStartTime(procStart);
    try {
      const files = await extractZip(zipFile);
      setStage("processing");
      const results = await processBatches(files, benefitList, false, (p) => setProgress(p));
      const procEnd = new Date();

      // Download zip
      const zipBlob = await assembleZip(results);
      const ts = procEnd.toISOString().slice(0, 19).replace(/[T:]/g, "-");
      downloadBlob(zipBlob, `cleaned_${ts}.zip`);

      // Download audit log
      const log = buildAuditLog(results, benefitList, false, procStart, procEnd);
      downloadBlob(new Blob([log], { type: "text/plain" }), `audit_${ts}.log`);

      setDryResults(results);
      setStage("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("error");
    }
  }

  function handleReset() {
    setZipFile(null);
    setBenefits("");
    setStage("idle");
    setProgress(null);
    setDryResults([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const ok      = dryResults.filter((r) => r.status === "ok").length;
  const skipped = dryResults.filter((r) => r.status === "skipped").length;
  const errors  = dryResults.filter((r) => r.status === "error").length;
  const renames = dryResults.filter((r) => r.tabs_renamed.length > 0).length;

  const progressPct = progress
    ? Math.round((progress.filesProcessed / progress.totalFiles) * 100)
    : 0;

  const isRunning = stage === "extracting" || stage === "dry_running" || stage === "processing";

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">File Parser</h1>
          <p className="text-gray-400 mt-1">Upload a zip of .xlsx files, define benefits to keep, preview and download.</p>
        </div>

        {/* Input form */}
        {(stage === "idle" || stage === "error") && (
          <div className="space-y-6 bg-gray-900 rounded-2xl p-6 border border-gray-800">
            {/* Zip upload */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Input ZIP file <span className="text-gray-500">(containing .xlsx files)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleZipChange}
                className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-700 file:text-white file:cursor-pointer hover:file:bg-indigo-600"
              />
              {zipFile && (
                <p className="text-xs text-gray-500 mt-1">{zipFile.name} — {(zipFile.size / 1024 / 1024).toFixed(1)} MB</p>
              )}
            </div>

            {/* Benefits textarea */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Benefits to keep <span className="text-gray-500">(one per line)</span>
              </label>
              <textarea
                value={benefits}
                onChange={(e) => setBenefits(e.target.value)}
                placeholder={"LIFE\nWOP\nCI\nMEDEX"}
                rows={6}
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
              {benefitList.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">{benefitList.length} benefit{benefitList.length !== 1 ? "s" : ""} defined</p>
              )}
            </div>

            {error && <p className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-2">{error}</p>}

            <button
              onClick={handleDryRun}
              disabled={!zipFile || benefitList.length === 0}
              className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed font-medium transition-colors"
            >
              Run Dry Run Preview
            </button>
          </div>
        )}

        {/* Progress */}
        {isRunning && (
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 space-y-4">
            <div className="flex justify-between text-sm text-gray-400">
              <span>
                {stage === "extracting" && "Extracting zip..."}
                {stage === "dry_running" && "Running preview..."}
                {stage === "processing" && "Processing files..."}
              </span>
              {progress && (
                <span>{progress.filesProcessed} / {progress.totalFiles} files  (batch {progress.batchIndex}/{progress.totalBatches})</span>
              )}
            </div>
            <div className="w-full bg-gray-800 rounded-full h-3">
              <div
                className="bg-indigo-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center">{progressPct}%</p>
          </div>
        )}

        {/* Dry run preview */}
        {stage === "previewing" && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Would Clean",  value: ok,      color: "text-green-400"  },
                { label: "Would Skip",   value: skipped, color: "text-yellow-400" },
                { label: "Errors",       value: errors,  color: "text-red-400"    },
                { label: "Auto-Rename",  value: renames, color: "text-blue-400"   },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
                  <p className={`text-3xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* File table */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex justify-between items-center">
                <h2 className="font-semibold">Preview — {dryResults.length} files</h2>
                <span className="text-xs text-gray-500">Review before proceeding</span>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-850 border-b border-gray-800">
                    <tr className="text-left text-xs text-gray-500 bg-gray-900">
                      <th className="px-4 py-2 font-medium">File</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Kept</th>
                      <th className="px-4 py-2 font-medium">Removed</th>
                      <th className="px-4 py-2 font-medium">Renamed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {dryResults.map((r) => (
                      <tr key={r.file} className="hover:bg-gray-800/50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-300 max-w-xs truncate">{r.file}</td>
                        <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-2 text-xs text-green-400">{r.tabs_kept.join(", ") || "—"}</td>
                        <td className="px-4 py-2 text-xs text-red-400">{r.tabs_removed.join(", ") || "—"}</td>
                        <td className="px-4 py-2 text-xs text-blue-400">
                          {r.tabs_renamed.length > 0
                            ? r.tabs_renamed.map((rn) => `"${rn.from}" → "${rn.to}"`).join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 font-medium transition-colors"
              >
                Cancel / Start Over
              </button>
              <button
                onClick={handleProceed}
                className="flex-2 flex-grow-[2] py-3 rounded-lg bg-green-700 hover:bg-green-600 font-medium transition-colors"
              >
                Proceed — Clean &amp; Download
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {stage === "done" && (
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center space-y-4">
            <div className="text-5xl">✓</div>
            <h2 className="text-2xl font-bold text-green-400">Done!</h2>
            <p className="text-gray-400">
              {ok} file{ok !== 1 ? "s" : ""} cleaned — <strong className="text-white">cleaned.zip</strong> and <strong className="text-white">audit.log</strong> downloaded.
            </p>
            {skipped > 0 && <p className="text-yellow-400 text-sm">{skipped} file{skipped !== 1 ? "s" : ""} skipped (no matching tabs).</p>}
            {errors > 0  && <p className="text-red-400 text-sm">{errors} file{errors !== 1 ? "s" : ""} had errors — check audit log.</p>}
            <button
              onClick={handleReset}
              className="mt-4 px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium transition-colors"
            >
              Process Another Batch
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
