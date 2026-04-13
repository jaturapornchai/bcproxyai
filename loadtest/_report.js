// Shared handleSummary helper for all k6 scripts — POSTs a compact summary
// to /api/k6-report so the dashboard InfraPanel can display last-run stats.
// Keep this file framework-agnostic (k6 has no package.json resolution).

import http from "k6/http";

export function reportTo(baseUrl, scriptName) {
  return function handleSummary(data) {
    const metrics = data.metrics || {};
    const httpReqs = metrics.http_reqs?.values?.count ?? 0;
    const httpFailed = metrics.http_req_failed?.values?.rate ?? 0;
    const duration = metrics.http_req_duration?.values ?? {};
    const checks = metrics.checks?.values ?? {};
    const vusMax = metrics.vus_max?.values?.max ?? 0;

    const payload = {
      script: scriptName,
      checks: {
        passes: checks.passes ?? 0,
        fails: checks.fails ?? 0,
      },
      metrics: {
        http_reqs: httpReqs,
        http_req_failed_rate: httpFailed,
        avg: duration.avg ?? 0,
        p95: duration["p(95)"] ?? 0,
        p99: duration["p(99)"] ?? 0,
      },
      duration: data.state?.testRunDurationMs ?? 0,
      vus: vusMax,
    };

    try {
      http.post(`${baseUrl}/api/k6-report`, JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (_err) {
      // ignore — report is best-effort, don't fail the test
    }

    // Also print the default text summary to stdout so k6 CLI output stays useful
    return {
      stdout: renderTextSummary(data),
    };
  };
}

function renderTextSummary(data) {
  const m = data.metrics || {};
  const lines = [];
  lines.push("");
  lines.push("─── k6 summary ────────────────────────────────");
  if (m.http_reqs?.values?.count !== undefined) {
    lines.push(`  http_reqs:      ${m.http_reqs.values.count}`);
  }
  if (m.http_req_duration?.values) {
    const d = m.http_req_duration.values;
    lines.push(`  avg:            ${Math.round(d.avg ?? 0)}ms`);
    lines.push(`  p95:            ${Math.round(d["p(95)"] ?? 0)}ms`);
    lines.push(`  p99:            ${Math.round(d["p(99)"] ?? 0)}ms`);
  }
  if (m.http_req_failed?.values?.rate !== undefined) {
    lines.push(`  failed:         ${(m.http_req_failed.values.rate * 100).toFixed(2)}%`);
  }
  if (m.checks?.values) {
    const c = m.checks.values;
    lines.push(`  checks:         ${c.passes ?? 0} passed, ${c.fails ?? 0} failed`);
  }
  lines.push("───────────────────────────────────────────────");
  lines.push("");
  return lines.join("\n");
}
