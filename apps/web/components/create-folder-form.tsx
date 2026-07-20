"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFolderAction } from "@/lib/actions";

export function CreateFolderForm() {
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    try {
      await createFolderAction(new FormData(form));
      toast.success("Folder created");
      form.reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label htmlFor="folder-name">Name</Label>
        <Input
          id="folder-name"
          name="name"
          placeholder="e.g. photos-2026"
          pattern="[a-z0-9][a-z0-9-]{0,63}"
          title="lowercase letters, digits and dashes"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="folder-tags">Tags (optional)</Label>
        <Input id="folder-tags" name="tags" placeholder="photos,archive" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create folder"}
      </Button>
    </form>
  );
}
