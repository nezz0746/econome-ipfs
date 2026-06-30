"use client";

import { useState } from "react";
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
import { testUpload, type UploadResult } from "@/lib/actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

export default function UploadPage() {
  const [results, setResults] = useState<UploadResult[]>([]);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const apiKey = String(formData.get("apiKey") ?? "");
    const files = formData
      .getAll("file")
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (!apiKey) {
      toast.error("API key required");
      return;
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

    setPending(true);
    setResults([]);

    // One request per file so each file gets its own body-size budget.
    const settled = await Promise.all(
      toUpload.map((file) => {
        const fd = new FormData();
        fd.append("apiKey", apiKey);
        fd.append("file", file, file.name);
        return testUpload(fd);
      }),
    );

    setPending(false);
    setResults(settled);

    const ok = settled.filter((r) => r.cid).length;
    const failed = settled.length - ok;
    if (ok > 0) toast.success(`Pinned ${ok} file(s) across the cluster`);
    if (failed > 0) toast.error(`${failed} file(s) failed`);
  }

  return (
    <>
      <PageHeader
        title="Test Upload"
        description="A developer aid: push files through the same API-key-gated ingest path machine clients use. Each CID is added to the main node and pinned across the cluster."
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
            <div className="space-y-2">
              <Label htmlFor="file">Files</Label>
              <Input id="file" name="file" type="file" multiple required />
              <p className="text-xs text-muted-foreground">
                Max {MAX_UPLOAD_MB} MB per file. Batch uploads supported.
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
        </CardContent>
      </Card>
    </>
  );
}
