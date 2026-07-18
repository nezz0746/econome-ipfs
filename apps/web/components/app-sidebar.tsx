"use client";

import {
  Files,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Network,
  Upload,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EconomeMark } from "@/components/econome-mark";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const NAV = [
  { title: "Overview", url: "/dashboard", icon: LayoutDashboard },
  { title: "Files", url: "/dashboard/files", icon: Files },
  { title: "Peers & Followers", url: "/dashboard/peers", icon: Network },
  { title: "Onboarding", url: "/dashboard/onboarding", icon: UserPlus },
  { title: "API Keys", url: "/dashboard/api-keys", icon: KeyRound },
  { title: "Test Upload", url: "/dashboard/upload", icon: Upload },
];

function isActive(pathname: string, url: string): boolean {
  return url === "/dashboard" ? pathname === url : pathname.startsWith(url);
}

export function AppSidebar({
  user,
}: {
  user: { name?: string; email: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  // Navigate inside a transition so we can show a per-item loader while the
  // next route's server components stream in.
  const go = (url: string) => {
    if (url === pathname) return;
    setTarget(url);
    startTransition(() => router.push(url));
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <EconomeMark className="aspect-square size-8 shrink-0" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-heading text-base">
                  L&apos;Économe
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  IPFS Storage Center
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const pending = isPending && target === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      render={<Link href={item.url} />}
                      onClick={(e) => {
                        // Left-click only; let modifier/middle-clicks open a tab.
                        if (
                          e.metaKey ||
                          e.ctrlKey ||
                          e.shiftKey ||
                          e.button !== 0
                        )
                          return;
                        e.preventDefault();
                        go(item.url);
                      }}
                      isActive={isActive(pathname, item.url)}
                      tooltip={item.title}
                    >
                      {pending ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <item.icon />
                      )}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
