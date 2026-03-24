import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("days");
  const days = Math.min(365, Math.max(1, Number.parseInt(raw ?? "30", 10) || 30));

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("link_validator_analytics_timeseries", {
    p_days: days,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
