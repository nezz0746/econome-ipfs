"use client";

import {
  Boxes,
  Files,
  KeyRound,
  LayoutDashboard,
  Network,
  Upload,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Boxes className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-heading text-base">L&apos;Économe</span>
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
              {NAV.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    render={<Link href={item.url} />}
                    isActive={isActive(pathname, item.url)}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
