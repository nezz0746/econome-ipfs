import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";

// Browser-reachable API base. Empty (e.g. prod before a domain is attached)
// hides the sidebar docs link — never render a broken one.
const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
const API_DOCS_URL = API_PUBLIC_URL ? `${API_PUBLIC_URL}/docs` : null;

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Authoritative session check (the edge proxy only verifies cookie presence).
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar
        user={{ name: session.user.name, email: session.user.email }}
        apiDocsUrl={API_DOCS_URL}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-semibold">Econome</span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
