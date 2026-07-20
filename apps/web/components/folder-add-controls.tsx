"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCidToFolderAction, uploadFolderEntry } from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

/**
 * Add content to a folder at the currently browsed path: upload files
 * (session-gated, no API key) or mount an existing CID. Uploads batch as
 * ONE folder version: commit=false on all but the last file.
 */
export function FolderAddControls({
  folderName,
  currentPath,
}: {
  folderName: string;
  currentPath: string;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [addingCid, setAddingCid] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const destPath = (leaf: string) =>
    currentPath ? `${currentPath}/${leaf}` : leaf;

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const allFiles = Array.from(fileInputRef.current?.files ?? []);
    const files = allFiles.filter((f) => f.size > 0);
    const emptyCount = allFiles.length - files.length;
    if (emptyCount > 0) {
      toast.error(`${emptyCount} empty file(s) skipped`);
    }
    if (files.length === 0) {
      toast.error("Choose at least one file");
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

    setUploading(true);
    try {
      let failed = 0;
      let committed = false;
      for (const [i, file] of toUpload.entries()) {
        const fd = new FormData();
        fd.append("name", folderName);
        fd.append("path", destPath(file.name));
        const isLast = i === toUpload.length - 1;
        fd.append("commit", isLast ? "true" : "false");
        fd.append("file", file, file.name);
        const res = await uploadFolderEntry(fd);
        if (!res.ok) {
          failed += 1;
          toast.error(`${file.name}: ${res.error ?? "upload failed"}`);
        } else if (isLast) {
          committed = true;
        }
      }
      const ok = toUpload.length - failed;
      if (ok > 0 && committed) {
        toast.success(`Added ${ok} file(s) to '${folderName}'`);
        if (failed === 0 && fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        router.refresh();
      } else if (ok > 0 && !committed) {
        toast.warning(
          `${ok} file(s) staged, but the new folder version couldn't be committed — it will finalize automatically within a minute`,
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function onAddCid(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const leaf = String(fd.get("entryName") ?? "").trim();
    const payload = new FormData();
    payload.append("name", folderName);
    payload.append("cid", String(fd.get("cid") ?? ""));
    payload.append("path", leaf ? destPath(leaf) : "");
    setAddingCid(true);
    try {
      const res = await addCidToFolderAction(payload);
      if (res.ok) {
        toast.success("CID mounted into the folder");
        form.reset();
        router.refresh();
      } else {
        toast.error(res.error ?? "add failed");
      }
    } finally {
      setAddingCid(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-x-8 gap-y-4 pt-6">
        <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="folder-add-files">
              Upload {currentPath ? `into ${currentPath}/` : "files"}
            </Label>
            <Input
              id="folder-add-files"
              type="file"
              multiple
              ref={fileInputRef}
              disabled={uploading}
            />
            <p className="text-xs text-muted-foreground">
              Max {MAX_UPLOAD_MB} MB per file. The batch lands as one new folder
              version.
            </p>
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Add to folder"}
          </Button>
        </form>

        <form onSubmit={onAddCid} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="folder-add-cid">Add existing CID</Label>
            <Input
              id="folder-add-cid"
              name="cid"
              placeholder="bafy…"
              className="font-mono"
              required
              disabled={addingCid}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="folder-add-cid-name">Name in folder</Label>
            <Input
              id="folder-add-cid-name"
              name="entryName"
              placeholder="e.g. archive.tar"
              required
              disabled={addingCid}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={addingCid}>
            {addingCid ? "Adding…" : "Mount CID"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
