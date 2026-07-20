"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ensureFolder,
  type FolderUploadResult,
  testUpload,
  type UploadResult,
  uploadFolderFile,
} from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

type Mode = "individual" | "folder";

/** Relative path for a picked file: directory picks carry webkitRelativePath. */
function relPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

export default function UploadPage() {
  const [mode, setMode] = useState<Mode>("individual");
  const [pickDirectory, setPickDirectory] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [folderResults, setFolderResults] = useState<FolderUploadResult[]>([]);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const apiKey = String(formData.get("apiKey") ?? "");
    const tags = String(formData.get("tags") ?? "");
    const folder = String(formData.get("folder") ?? "").trim();
    const files = (formData.getAll("file") as unknown[]).filter(
      (f): f is File => f instanceof File && f.size > 0,
    );

    if (!apiKey) {
      toast.error("API key required");
      return;
    }
    if (files.length === 0) {
      toast.error("Choose at least one file");
      return;
    }
    if (mode === "folder" && !folder) {
      toast.error("Folder name required in folder mode");
      return;
    }

    const oversized = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversized.length > 0) {
      toast.error(
        `${oversized.length} file(s) exceed the ${MAX_UPLOAD_MB} MB limit and were skipped`,
      );
    }
    const toUpload = files.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (toUpload.length === 0) return;

    setPending(true);
    setResults([]);
    setFolderResults([]);

    try {
      if (mode === "individual") {
        // One request per file so each file gets its own body-size budget.
        const settled = await Promise.all(
          toUpload.map((file) => {
            const fd = new FormData();
            fd.append("apiKey", apiKey);
            fd.append("tags", tags);
            fd.append("file", file, file.name);
            return testUpload(fd);
          }),
        );
        setResults(settled);
        const ok = settled.filter((r) => r.cid).length;
        if (ok > 0) toast.success(`Pinned ${ok} file(s) across the cluster`);
        if (settled.length - ok > 0)
          toast.error(`${settled.length - ok} file(s) failed`);
      } else {
        // Folder mode: create-or-reuse the folder, then upload sequentially —
        // commit=false on all but the last file so the batch lands as ONE new
        // folder version (one pin + one IPNS update).
        const create = new FormData();
        create.append("apiKey", apiKey);
        create.append("folder", folder);
        create.append("tags", tags);
        const created = await ensureFolder(create);
        if (!created.ok) {
          toast.error(created.error ?? "Folder create failed");
          return;
        }
        const settled: FolderUploadResult[] = [];
        for (const [i, file] of toUpload.entries()) {
          const fd = new FormData();
          fd.append("apiKey", apiKey);
          fd.append("folder", folder);
          fd.append("path", relPath(file));
          fd.append("commit", i === toUpload.length - 1 ? "true" : "false");
          fd.append("file", file, file.name);
          settled.push(await uploadFolderFile(fd));
        }
        setFolderResults(settled);
        const ok = settled.filter((r) => r.ok).length;
        const root = settled[settled.length - 1]?.rootCid;
        if (ok > 0)
          toast.success(
            `Added ${ok} file(s) to '${folder}'${root ? ` — new root ${root}` : ""}`,
          );
        if (settled.length - ok > 0)
          toast.error(`${settled.length - ok} file(s) failed`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Test Upload"
        description="A developer aid: push files through the same API-key-gated ingest paths machine clients use — as individual pins, or into a mutable folder."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Upload &amp; pin</CardTitle>
          <CardDescription>
            Requires an active API key from the API Keys page. Select one or
            more files — up to {MAX_UPLOAD_MB} MB each.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" name="apiKey" placeholder="eco_…" required />
            </div>

            <fieldset className="space-y-2">
              <Label>Pin as</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "individual"}
                    onChange={() => setMode("individual")}
                  />
                  Individual files
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "folder"}
                    onChange={() => setMode("folder")}
                  />
                  Folder
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "individual"
                  ? "Each file becomes its own pin, exactly like the machine /ingest path."
                  : "Files land in one mutable folder: a single pin, a browsable /ipfs/ directory, and a stable /ipns/ URL."}
              </p>
            </fieldset>

            {mode === "folder" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="folder">Folder name</Label>
                  <Input
                    id="folder"
                    name="folder"
                    placeholder="e.g. photos-2026"
                    pattern="[a-z0-9][a-z0-9-]{0,63}"
                    title="lowercase letters, digits and dashes"
                  />
                  <p className="text-xs text-muted-foreground">
                    Created if it doesn't exist; otherwise files are added to
                    it.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pickDirectory}
                    onChange={(e) => {
                      setPickDirectory(e.target.checked);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                  Pick a whole directory (keeps its structure)
                </label>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="file">Files</Label>
              <Input
                key={mode === "folder" && pickDirectory ? "dir" : "files"}
                id="file"
                name="file"
                type="file"
                multiple
                required
                ref={fileInputRef}
                {...(mode === "folder" && pickDirectory
                  ? ({ webkitdirectory: "" } as Record<string, string>)
                  : {})}
              />
              <p className="text-xs text-muted-foreground">
                Max {MAX_UPLOAD_MB} MB per file. Batch uploads supported.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags (optional)</Label>
              <Input id="tags" name="tags" placeholder="e.g. photos,archive" />
              <p className="text-xs text-muted-foreground">
                {mode === "folder"
                  ? "Tags apply to the folder: participants subscribed to one of them replicate the whole folder."
                  : "Tagged content is replicated by the main node and participants subscribed to one of its tags."}
              </p>
            </div>

            <Button type="submit" disabled={pending}>
              {pending ? "Uploading…" : "Upload & pin"}
            </Button>
          </form>

          {results.length > 0 && (
            <div className="mt-4 space-y-3">
              {results.map((r) => (
                <div key={`${r.name}-${r.cid ?? r.error}`}>
                  <p className="mb-1 text-sm text-muted-foreground break-all">
                    {r.name}
                  </p>
                  {r.cid ? (
                    <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
                      {r.cid}
                    </div>
                  ) : (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive break-all">
                      {r.error ?? "upload failed"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {folderResults.length > 0 && (
            <div className="mt-4 space-y-1">
              {folderResults.map((r) => (
                <p
                  key={r.path}
                  className={`text-sm break-all ${r.ok ? "text-muted-foreground" : "text-destructive"}`}
                >
                  {r.ok ? "✓" : "✗"} {r.path}
                  {r.error ? ` — ${r.error}` : ""}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
