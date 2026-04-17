import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";

import { getTemplateScaledPageSize, resolveTemplateRegionLayouts } from "@/lib/templateLayout";
import { LabAnalysisReport } from "@/types/labReport";
import { ConsultationReport } from "@/types/report";
import { PdfTemplate } from "@/types/template";

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

function renderStandardReportPageHtml(report: ConsultationReport) {
  const privacyMode = report.privacy?.mode === "redacted";
  const transcriptExcludedFromPdf = report.privacy?.transcriptExcludedFromPdf;

  return `
    <div class="note-page">
      <div class="badge">Elfie Scribe</div>
      <h1>Consultation Report</h1>
      <div class="muted">Generated ${new Date(report.createdAt).toLocaleString()}</div>
      ${
        privacyMode
          ? '<div class="privacy-callout"><strong>Privacy mode:</strong> direct identifiers were redacted before extraction. This PDF omits the full transcript.</div>'
          : ""
      }

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
            ...report.soap.plan.referrals,
            ...report.soap.plan.followUp,
            ...report.soap.plan.patientInstructions,
            ...report.soap.plan.clinicianTasks,
            ...report.soap.plan.lifestyleAdvice,
          ])}</ul>
        </div>
      </div>

      <h2>Missing or Ambiguous Info</h2>
      <ul>${renderList([...report.quality.missingInformation, ...report.quality.ambiguities])}</ul>

      <h2>Transcript</h2>
      ${
        transcriptExcludedFromPdf
          ? '<div class="privacy-note">Transcript omitted from PDF in privacy mode. Review the redacted transcript in-app if needed.</div>'
          : `<div class="transcript">${escapeHtml(report.transcript.fullText)}</div>`
      }
    </div>
  `;
}

async function renderTemplatePageHtml(template: PdfTemplate, report: ConsultationReport) {
  if (!Number.isFinite(template.width) || !Number.isFinite(template.height) || template.width <= 0 || template.height <= 0) {
    throw new Error("Template dimensions are invalid.");
  }

  const previewBase64 = await FileSystem.readAsStringAsync(template.previewUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const imageUri = `data:${template.previewMimeType};base64,${previewBase64}`;
  const { pageWidth, pageHeight } = getTemplateScaledPageSize(template);
  const regionLayouts = resolveTemplateRegionLayouts(template, report);

  const boxes = regionLayouts
    .map((layout) => {
      const style = layout.region.style;
      const titleHtml = layout.title ? `<div class="region-title">${escapeHtml(layout.title)}</div>` : "";
      const linesHtml = layout.displayLines
        .map((line, index) => `<div class="region-line region-line-${index === 0 ? "primary" : "secondary"}">${escapeHtml(line)}</div>`)
        .join("");

      return `
        <div
          class="template-box"
          style="
            left:${layout.region.x * pageWidth}px;
            top:${layout.region.y * pageHeight}px;
            width:${layout.region.width * pageWidth}px;
            height:${layout.region.height * pageHeight}px;
            padding:${style?.paddingY ?? 8}px ${style?.paddingX ?? 10}px;
            background:rgba(255, 255, 255, ${style?.backgroundOpacity ?? 0.82});
            font-size:${layout.fontSize}px;
            line-height:${layout.lineHeight}px;
          "
        >
          ${titleHtml}
          <div class="region-content">${linesHtml}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div
      class="template-page page-break"
      style="
        width:${pageWidth}px;
        height:${pageHeight}px;
      "
    >
      <img class="template-background" src="${imageUri}" />
      ${boxes}
    </div>
  `;
}

export async function renderReportHtml(report: ConsultationReport, template?: PdfTemplate | null) {
  let templatePage = "";
  if (template) {
    try {
      templatePage = await renderTemplatePageHtml(template, report);
    } catch (error) {
      console.warn("[pdf] template render failed, falling back to standard layout", error);
    }
  }

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #14142b;
          margin: 0;
          background: #ffffff;
          line-height: 1.45;
        }
        .page-break {
          page-break-after: always;
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
        .privacy-callout,
        .privacy-note {
          margin-top: 20px;
          background: #fff7e6;
          border: 1px solid #f6d28b;
          border-radius: 16px;
          padding: 16px 18px;
          color: #6f4b00;
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
        .note-page {
          padding: 32px;
        }
        .template-page {
          position: relative;
          margin: 0 auto;
          background: #ffffff;
        }
        .template-background {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }
        .template-box {
          position: absolute;
          overflow: hidden;
          box-sizing: border-box;
          color: #14142b;
          border-radius: 10px;
          border: 1px solid rgba(20, 20, 43, 0.08);
        }
        .region-title {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #776e91;
          margin-bottom: 4px;
        }
        .region-content {
          display: block;
        }
        .region-line {
          color: #4e4b66;
          word-break: break-word;
        }
        .region-line + .region-line {
          margin-top: 2px;
        }
        .region-line-primary {
          font-weight: 600;
          color: #14142b;
        }
      </style>
    </head>
    <body>
      ${templatePage}
      ${renderStandardReportPageHtml(report)}
    </body>
  </html>
`;
}

export async function generateReportPdfAsync(report: ConsultationReport, template?: PdfTemplate | null) {
  const html = await renderReportHtml(report, template);
  const result = await Print.printToFileAsync({ html });
  return result.uri;
}

function renderLabFindingCards(findings: LabAnalysisReport["abnormalFindings"]) {
  if (!findings.length) {
    return '<div class="empty-card">No urgent or abnormal findings were prioritized in this analysis.</div>';
  }

  return findings
    .map(
      (finding) => `
        <div class="finding-card">
          <div class="finding-meta">${escapeHtml(formatLabSeverity(finding.severity))} · ${escapeHtml(
            formatActionability(finding.actionability),
          )}</div>
          <div class="finding-title">${escapeHtml(finding.title)}</div>
          <div class="finding-body">${escapeHtml(finding.explanation)}</div>
        </div>
      `,
    )
    .join("");
}

function renderLabResultRows(results: LabAnalysisReport["results"]) {
  if (!results.length) {
    return '<div class="empty-card">No lab rows could be extracted.</div>';
  }

  return results
    .map(
      (result) => `
        <div class="result-row">
          <div class="result-header">
            <div class="result-title">${escapeHtml(result.testNameCanonical ?? result.testNameRaw)}</div>
            <div class="result-badge">${escapeHtml(formatLabFlag(result.flag))}</div>
          </div>
          <div class="result-meta">${escapeHtml(result.panelName ?? "Uncategorized")}</div>
          <div class="result-grid">
            <div><strong>Value:</strong> ${escapeHtml(formatLabResultValue(result)) || "Not stated"}</div>
            <div><strong>Range:</strong> ${escapeHtml(result.referenceRangeRaw ?? "Not stated")}</div>
            <div><strong>Severity:</strong> ${escapeHtml(formatLabSeverity(result.severity))}</div>
            <div><strong>Confidence:</strong> ${Math.round(result.confidence * 100)}%</div>
          </div>
          <div class="result-copy">${escapeHtml(result.clinicalMeaning || "No interpretation available.")}</div>
          <div class="result-copy">${escapeHtml(result.patientExplanation || "No patient explanation available.")}</div>
          ${
            result.recommendedFollowUp
              ? `<div class="result-followup"><strong>Suggested follow-up:</strong> ${escapeHtml(result.recommendedFollowUp)}</div>`
              : ""
          }
        </div>
      `,
    )
    .join("");
}

function renderNextStepBucket(title: string, items: string[]) {
  return `
    <div class="next-step-card">
      <div class="next-step-title">${escapeHtml(title)}</div>
      <ul>${renderList(items)}</ul>
    </div>
  `;
}

async function renderLabReportHtml(report: LabAnalysisReport) {
  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: #14142b;
          margin: 0;
          background: #ffffff;
          line-height: 1.45;
        }
        .page {
          padding: 32px;
        }
        .badge {
          display: inline-block;
          background: #e8f7ff;
          color: #04506b;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        h1, h2, h3 {
          color: #14142b;
          margin-bottom: 8px;
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
        .muted {
          color: #776e91;
        }
        .summary {
          background: #f7f7fc;
          border: 1px solid #eff0f6;
          border-radius: 18px;
          padding: 20px;
          margin-top: 20px;
        }
        .callout {
          margin-top: 18px;
          background: #fff7e6;
          border: 1px solid #f6d28b;
          border-radius: 16px;
          padding: 16px 18px;
          color: #6f4b00;
        }
        .finding-card,
        .result-row,
        .next-step-card,
        .empty-card {
          border: 1px solid #eff0f6;
          border-radius: 18px;
          padding: 16px 18px;
          background: #ffffff;
          margin-top: 14px;
        }
        .finding-meta,
        .result-meta {
          color: #776e91;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .finding-title,
        .result-title,
        .next-step-title {
          font-size: 16px;
          font-weight: 700;
          color: #14142b;
          margin-top: 4px;
        }
        .finding-body,
        .result-copy,
        .result-followup {
          margin-top: 8px;
        }
        .result-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
        }
        .result-badge {
          background: #eff9f3;
          color: #2f8f67;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .result-grid {
          display: table;
          width: 100%;
          margin-top: 10px;
        }
        .result-grid > div {
          display: table-cell;
          width: 25%;
          padding-right: 10px;
          vertical-align: top;
          font-size: 13px;
        }
        .source-text {
          white-space: pre-wrap;
          background: #f7f7fc;
          border-radius: 18px;
          padding: 20px;
          border: 1px solid #eff0f6;
          margin-top: 14px;
        }
        ul {
          padding-left: 20px;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="badge">Elfie Labs</div>
        <h1>Lab Analysis Report</h1>
        <div class="muted">Generated ${escapeHtml(new Date(report.createdAt).toLocaleString())}</div>
        <div class="muted">
          ${escapeHtml(report.sourceDocument.sourceType.toUpperCase())}
          · ${escapeHtml((report.language.detected || "unknown").toUpperCase())}
          · ${escapeHtml(report.processing.mode.replace("_", " "))}
        </div>

        ${
          report.processing.mode !== "hybrid"
            ? `<div class="callout"><strong>Processing mode:</strong> this report used ${escapeHtml(
                report.processing.mode.replace("_", " "),
              )} mode, so interpretation quality may be lower than the full hybrid path.</div>`
            : ""
        }

        <div class="summary">
          <h3>${escapeHtml(report.summary.headline)}</h3>
          <ul>${renderList(report.summary.bullets)}</ul>
        </div>

        <h2>Priority Findings</h2>
        ${renderLabFindingCards(report.abnormalFindings)}

        <h2>Next Steps</h2>
        ${renderNextStepBucket("Urgent attention", report.nextSteps.urgentAttention)}
        ${renderNextStepBucket("Discuss with clinician soon", report.nextSteps.discussWithClinicianSoon)}
        ${renderNextStepBucket("Routine follow-up or monitoring", report.nextSteps.routineFollowUpOrMonitoring)}

        <h2>Results</h2>
        ${renderLabResultRows(report.results)}

        <h2>Quality Notes</h2>
        <ul>${renderList([
          ...report.quality.missingInformation,
          ...report.quality.ambiguities,
          ...report.quality.warnings,
          ...report.quality.processingNotes,
        ])}</ul>

        <h2>Sanitized Source Text</h2>
        <div class="source-text">${escapeHtml(report.sourceText)}</div>
      </div>
    </body>
  </html>
`;
}

export async function generateLabReportPdfAsync(report: LabAnalysisReport) {
  const html = await renderLabReportHtml(report);
  const result = await Print.printToFileAsync({ html });
  return result.uri;
}

function formatLabFlag(value: LabAnalysisReport["results"][number]["flag"]) {
  return value.replaceAll("_", " ");
}

function formatLabSeverity(value: LabAnalysisReport["summary"]["overallRisk"]) {
  return value.replaceAll("_", " ");
}

function formatActionability(value: LabAnalysisReport["abnormalFindings"][number]["actionability"]) {
  return value.replaceAll("_", " ");
}

function formatLabResultValue(result: LabAnalysisReport["results"][number]) {
  const valueRaw = result.valueRaw.trim();
  const unit = result.unit?.trim();

  if (!unit || valueRaw.toLowerCase().includes(unit.toLowerCase())) {
    return valueRaw;
  }

  return `${valueRaw} ${unit}`.trim();
}
