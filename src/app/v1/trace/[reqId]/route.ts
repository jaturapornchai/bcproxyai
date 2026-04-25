import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /v1/trace/:reqId
 *
 * Returns the gateway log entry for a given request id (from response header
 * X-SMLGateway-Request-Id). Lets devs inspect what happened: which model
 * answered, which provider, latency, input/output tokens, error (if any),
 * user message, assistant message.
 *
 * Response:
 *   {
 *     requestId: string,
 *     found: boolean,
 *     entry?: {
 *       id, request_model, resolved_model, provider, status, latency_ms,
 *       input_tokens, output_tokens, error, user_message, assistant_message,
 *       client_ip, created_at
 *     }
 *   }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ reqId: string }> }
) {
  try {
    const { reqId } = await params;
    if (!reqId || !/^[a-z0-9]{4,20}$/i.test(reqId)) {
      return NextResponse.json(
        { error: { message: "Invalid reqId format" } },
        { status: 400 }
      );
    }

    const sql = getSqlClient();
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT id, request_model, resolved_model, provider, status, latency_ms,
             input_tokens, output_tokens, error, user_message, assistant_message,
             client_ip, created_at, routing_explain
      FROM gateway_logs
      WHERE request_id = ${reqId}
      ORDER BY id DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { requestId: reqId, found: false },
        { status: 404 }
      );
    }

    return NextResponse.json({
      requestId: reqId,
      found: true,
      entry: rows[0],
    }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: String(err), type: "trace_error" } },
      { status: 500 }
    );
  }
}
