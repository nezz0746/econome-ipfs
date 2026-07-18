import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Streamed instantly while the uploads page queries the database. */
export default function FilesLoading() {
  return (
    <>
      <PageHeader
        title="Files"
        description="Content ingested into the cluster. Each file is pinned to the main node and its tag subscribers."
      />
      <Card>
        <CardContent className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}
