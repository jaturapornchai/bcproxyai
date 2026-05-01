import { NextResponse } from "next/server";
import { ensureWorkerStarted } from "@/lib/worker/startup";
import { getWorkerStatus, runWorkerCycle } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureWorkerStarted();
    const status = await getWorkerStatus();
    return NextResponse.json({ ok: true, worker: status });
  } catch (err) {
    console.error("[worker] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    ensureWorkerStarted();
    runWorkerCycle().catch((err) => {
      console.error("[worker] manual cycle error:", err);
    });
    return NextResponse.json({ ok: true, message: "Worker cycle triggered" });
  } catch (err) {
    console.error("[worker] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
