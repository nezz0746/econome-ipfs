"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { PeerSnapshot } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const chartConfig = {
  bytesHeld: {
    label: "Data held",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

/** Area chart of bytes held over time (oldest -> newest, left -> right). */
export function ContributionChart({ points }: { points: PeerSnapshot[] }) {
  // Snapshots arrive newest-first; reverse for chronological left-to-right.
  const data = [...points].reverse().map((p) => ({
    capturedAt: p.capturedAt,
    bytesHeld: p.bytesHeld,
  }));

  if (data.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">Not enough history yet.</p>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="capturedAt"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={(value: string) =>
            new Date(value).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={64}
          tickFormatter={(value: number) => formatBytes(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const at = payload?.[0]?.payload?.capturedAt;
                return at ? new Date(at).toLocaleString() : "";
              }}
              formatter={(value) => (
                <span className="font-mono">{formatBytes(Number(value))}</span>
              )}
            />
          }
        />
        <Area
          dataKey="bytesHeld"
          type="monotone"
          fill="var(--color-bytesHeld)"
          fillOpacity={0.15}
          stroke="var(--color-bytesHeld)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}
