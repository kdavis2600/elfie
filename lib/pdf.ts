import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";

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

function formatLines(items: string[], fallback = "Not stated") {
  return (items.length ? items : [fallback]).map((item) => escapeHtml(item)).join("<br />");
}

function buildTemplateRegionContent(report: ConsultationReport) {
  const objectiveItems = [
    ...report.soap.objective.vitals,
    ...report.soap.objective.findings,
    ...report.soap.objective.testsOrResults,
    ...report.soap.objective.observations,
  ];
  const planItems = [
    ...report.soap.plan.medications,
    ...report.soap.plan.testsOrdered,
    ...report.soap.plan.referrals,
    ...report.soap.plan.followUp,
    ...report.soap.plan.patientInstructions,
    ...report.soap.plan.clinicianTasks,
    ...report.soap.plan.lifestyleAdvice,
  ];

  return {
    header: `
      <div class="region-title">Visit summary</div>
      <div class="region-body">${escapeHtml(report.summary.oneLiner)}</div>
      <div class="region-meta">${escapeHtml(report.visit.visitReason)}</div>
      <div class="region-meta">${escapeHtml(new Date(report.createdAt).toLocaleDateString())}</div>
    `,
    history: `
      <div class="region-title">History and findings</div>
      <div class="region-body">${escapeHtml(report.soap.subjective.hpi || "Not stated")}</div>
      <div class="region-list">${formatLines([...report.soap.subjective.symptoms, ...objectiveItems].slice(0, 8))}</div>
    `,
    assessment: `
      <div class="region-title">Assessment</div>
      <div class="region-body">${escapeHtml(report.soap.assessment.summary || "Not stated")}</div>
      <div class="region-list">${formatLines(
        report.soap.assessment.diagnoses.map((item) => `${item.name} (${item.confidence})`).slice(0, 5),
      )}</div>
    `,
    plan: `
      <div class="region-title">Plan and follow-up</div>
      <div class="region-list">${formatLines(planItems.slice(0, 8))}</div>
    `,
  };
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
  const scale = Math.min(816 / template.width, 1056 / template.height);
  const pageWidth = Math.round(template.width * scale);
  const pageHeight = Math.round(template.height * scale);
  const regionContent = buildTemplateRegionContent(report);

  const boxes = template.regions
    .map((region) => {
      const html = regionContent[region.id];
      return `
        <div
          class="template-box"
          style="
            left:${region.x * pageWidth}px;
            top:${region.y * pageHeight}px;
            width:${region.width * pageWidth}px;
            height:${region.height * pageHeight}px;
          "
        >
          ${html}
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
          padding: 8px 10px;
          box-sizing: border-box;
          color: #14142b;
          font-size: 11px;
          line-height: 1.25;
          background: rgba(255, 255, 255, 0.82);
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
        .region-body {
          font-weight: 600;
          margin-bottom: 4px;
        }
        .region-meta {
          color: #4e4b66;
          font-size: 10px;
        }
        .region-list {
          margin-top: 4px;
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
