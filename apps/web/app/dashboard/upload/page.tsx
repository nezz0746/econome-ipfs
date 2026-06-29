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
import { testUpload } from "@/lib/actions";

export default function UploadPage() {
  const [cid, setCid] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setCid(null);
    const formData = new FormData(e.currentTarget);
    const res = await testUpload(formData);
    setPending(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (res.cid) {
      setCid(res.cid);
      toast.success("Pinned across the cluster");
    }
  }

  return (
    <>
      <PageHeader
        title="Test Upload"
        description="A developer aid: push a file through the same API-key-gated ingest path machine clients use. The CID is added to the main node and pinned across the cluster."
      />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Upload &amp; pin</CardTitle>
          <CardDescription>
            Requires an active API key from the API Keys page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" name="apiKey" placeholder="eco_…" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">File</Label>
              <Input id="file" name="file" type="file" required />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Uploading…" : "Upload & pin"}
            </Button>
          </form>

          {cid && (
            <div className="mt-4">
              <p className="mb-1 text-sm text-muted-foreground">Pinned CID</p>
              <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
                {cid}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
