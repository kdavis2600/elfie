import * as Print from "expo-print";

import { ConsultationReport } from "@/types/report";

function renderList(items: string[]) {
  if (!items.length) {
    return "<li>Not stated</li>";
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderReportHtml(report: ConsultationReport) {
  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #14142b;
          padding: 32px;
          line-height: 1.45;
        }
        .badge {
          display: inline-block;
          background: #ffe3f2;
          color: #ff0283;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        h1, h2, h3 {
          margin-bottom: 8px;
          color: #14142b;
        }
        h1 {
          font-size: 28px;
        }
        h2 {
          margin-top: 28px;
          border-top: 1px solid #dcddeb;
          padding-top: 18px;
          font-size: 18px;
        }
        .summary {
          background: #f7f7fc;
          border: 1px solid #eff0f6;
          border-radius: 18px;
          padding: 20px;
          margin-top: 20px;
        }
        .muted {
          color: #776e91;
        }
        ul {
          padding-left: 20px;
        }
        .columns {
          display: table;
          width: 100%;
        }
        .column {
          display: table-cell;
          width: 50%;
          vertical-align: top;
          padding-right: 14px;
        }
        .transcript {
          white-space: pre-wrap;
          background: #f7f7fc;
          border-radius: 18px;
          padding: 20px;
          border: 1px solid #eff0f6;
        }
      </style>
    </head>
    <body>
      <div class="badge">Elfie Scribe</div>
      <h1>Consultation Report</h1>
      <div class="muted">Generated ${new Date(report.createdAt).toLocaleString()}</div>

      <div class="summary">
        <h3>${escapeHtml(report.summary.oneLiner)}</h3>
        <div class="muted">Visit reason: ${escapeHtml(report.visit.visitReason)}</div>
        <ul>${renderList(report.summary.bullets)}</ul>
      </div>

      <h2>SOAP</h2>
      <div class="columns">
        <div class="column">
          <h3>Subjective</h3>
          <p>${escapeHtml(report.soap.subjective.hpi)}</p>
          <ul>${renderList(report.soap.subjective.symptoms)}</ul>
          <h3>Objective</h3>
          <ul>${renderList([
            ...report.soap.objective.vitals,
            ...report.soap.objective.findings,
            ...report.soap.objective.testsOrResults,
            ...report.soap.objective.observations,
          ])}</ul>
        </div>
        <div class="column">
          <h3>Assessment</h3>
          <p>${escapeHtml(report.soap.assessment.summary)}</p>
          <ul>${renderList(report.soap.assessment.diagnoses.map((item) => `${item.name} (${item.confidence})`))}</ul>
          <h3>Plan</h3>
          <ul>${renderList([
            ...report.soap.plan.medications,
            ...report.soap.plan.testsOrdered,
            ...report.soap.plan.followUp,
            ...report.soap.plan.patientInstructions,
          ])}</ul>
        </div>
      </div>

      <h2>Missing or Ambiguous Info</h2>
      <ul>${renderList([...report.quality.missingInformation, ...report.quality.ambiguities])}</ul>

      <h2>Transcript</h2>
      <div class="transcript">${escapeHtml(report.transcript.fullText)}</div>
    </body>
  </html>
`;
}

export async function generateReportPdfAsync(report: ConsultationReport) {
  const html = renderReportHtml(report);
  const result = await Print.printToFileAsync({ html });
  return result.uri;
}
