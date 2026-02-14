import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportLineItem = {
  description: string;
  category: string;
  amount: number;
};

export type ReportEntry = {
  id: string;
  date: Date;
  description: string;
  category: string;
  amount: number;
  currency: string;
  receiptsCount: number;
  accountEntry: { id: string; description: string; account: string } | null;
  lineItems?: ReportLineItem[];
};

export type ReportReceiptRow = {
  entryId: string;
  entryDate: Date;
  entryDescription: string;
  amount: number;
  receipt: {
    id: string;
    imageData: string | null;
    imageType: string | null;
    submitterName: string;
    purpose: string;
  };
};

export type ReportData = {
  entries: ReportEntry[];
  receiptsInOrder: ReportReceiptRow[];
  /** Balance at start of date range (sum of all entries before dateFrom). Null when no date range. */
  startingCashFlow: number | null;
  /** Balance at end of date range (starting + net in period). Null when no date range. */
  endingCashFlow: number | null;
};

export type ProjectReportBudgetPlanRow = {
  itemName: string;
  description: string;
  type: "expense" | "income";
  estimatedAmount: number;
  notes: string;
};

export type ProjectReportExpenditureRow = {
  date: Date;
  budgetItemName: string;
  description: string;
  amount: number;
  cashflowEntryId: string;
  lineItems?: ReportLineItem[];
};

export type ProjectReportIncomeRow = {
  date: Date;
  budgetItemName: string;
  description: string;
  amount: number;
  cashflowEntryId: string;
  lineItems?: ReportLineItem[];
};

export type ProjectReportData = {
  project: {
    id: string;
    name: string;
    description: string;
    category: string;
    eventDate: Date | null;
    status: string;
  };
  totalBudget: number;
  totalIncomeBudget: number;
  totalActual: number;
  totalActualIncome: number;
  budgetPlanRows: ProjectReportBudgetPlanRow[];
  expenditureRows: ProjectReportExpenditureRow[];
  incomeRows: ProjectReportIncomeRow[];
  receiptsInOrder: ReportReceiptRow[];
};

// Receipts: 4 per page in a 2×2 grid for readability (best practice for audit/expense reports)
const RECEIPTS_PER_PAGE = 4;
const PAGE_MARGIN = 15;
const RECEIPT_GAP = 10; // space between cells
// A4 portrait: 210×297mm. Usable ~180×267 after margins; 2×2 → cell ~85×128mm
const RECEIPT_CELL_W = (210 - 2 * PAGE_MARGIN - RECEIPT_GAP) / 2;
const RECEIPT_CELL_H = (297 - 2 * PAGE_MARGIN - 22 - RECEIPT_GAP) / 2; // 22 = header area
const RECEIPT_CAPTION_H = 8;
const RECEIPT_FOOTER_H = 10;
const RECEIPT_IMG_W = RECEIPT_CELL_W - 4;
const RECEIPT_IMG_H = RECEIPT_CELL_H - RECEIPT_CAPTION_H - RECEIPT_FOOTER_H - 4;

/** Format as PHP amount, no sign (magnitude only). */
function formatCurrency(value: number): string {
  const num = (value >= 0 ? value : -value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `PHP ${num}`;
}

/**
 * Builds a PDF with:
 * 1. Title + date range + tabular data (cashflow entries)
 * 2. Receipts in order, 4 per page in a 2×2 grid (best for readability)
 */
export function buildPdfReport(
  data: ReportData,
  options: { dateFrom?: string; dateTo?: string; title?: string } = {}
): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.getPageWidth();
  const pageH = doc.getPageHeight();

  // ----- Title & date range -----
  doc.setFontSize(18);
  doc.text(options.title ?? "Finance Report", PAGE_MARGIN, 18);
  doc.setFontSize(10);
  const dateRange =
    options.dateFrom && options.dateTo
      ? `${options.dateFrom} to ${options.dateTo}`
      : "All dates";
  doc.text(`Period: ${dateRange}`, PAGE_MARGIN, 25);
  doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, PAGE_MARGIN, 30);

  // ----- Starting Cash Flow (when date range is set) -----
  let tableStartY = 36;
  if (data.startingCashFlow != null) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(
      `Starting Cash Flow: ${formatCurrency(data.startingCashFlow)}`,
      PAGE_MARGIN,
      tableStartY
    );
    doc.setFont("helvetica", "normal");
    tableStartY += 8;
  }

  // ----- Table: Date | Description | Category | Credit | Debit -----
  // Credit = income (positive), Debit = expenses (negative shown as positive)
  const totalIncome = data.entries.reduce((sum, e) => sum + (e.amount > 0 ? e.amount : 0), 0);
  const totalExpenses = data.entries.reduce(
    (sum, e) => sum + (e.amount < 0 ? Math.abs(e.amount) : 0),
    0
  );
  const netCashflow = totalIncome - totalExpenses;

  doc.setFont("helvetica", "normal");
  const tableBody: string[][] = [];
  for (const e of data.entries) {
    const hasBreakdown = (e.lineItems?.length ?? 0) > 0;
    if (hasBreakdown) {
      tableBody.push([
        new Date(e.date).toLocaleDateString("en-PH"),
        e.description,
        e.category,
        "—",
        "—",
      ]);
      for (const li of e.lineItems!) {
        tableBody.push([
          "",
          "  \u2022 " + li.description,
          li.category,
          li.amount > 0 ? formatCurrency(li.amount) : "—",
          li.amount < 0 ? formatCurrency(Math.abs(li.amount)) : "—",
        ]);
      }
    } else {
      tableBody.push([
        new Date(e.date).toLocaleDateString("en-PH"),
        e.description,
        e.category,
        e.amount > 0 ? formatCurrency(e.amount) : "—",
        e.amount < 0 ? formatCurrency(Math.abs(e.amount)) : "—",
      ]);
    }
  }
  autoTable(doc, {
    startY: tableStartY,
    head: [["Date", "Description", "Category", "Credit", "Debit"]],
    body: tableBody,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
    headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 24, font: "helvetica", fontStyle: "normal" },
      1: { cellWidth: 50, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      2: { cellWidth: 28, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      3: { cellWidth: 38, halign: "right", font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      4: { cellWidth: 38, halign: "right", font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
    },
  });

  // ----- Summary: Total Income, Total Expenses, Net Cashflow, Ending Cash Flow -----
  const finalY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableStartY;
  let summaryY = finalY + 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Total Income:", PAGE_MARGIN, summaryY);
  doc.text(formatCurrency(totalIncome), pageW - PAGE_MARGIN - 40, summaryY, { align: "right" });
  summaryY += 7;
  doc.text("Total Expenses:", PAGE_MARGIN, summaryY);
  doc.text(formatCurrency(totalExpenses), pageW - PAGE_MARGIN - 40, summaryY, { align: "right" });
  summaryY += 7;
  doc.text("Net Cashflow:", PAGE_MARGIN, summaryY);
  const netStr = netCashflow < 0 ? `- ${formatCurrency(Math.abs(netCashflow))}` : formatCurrency(netCashflow);
  doc.text(netStr, pageW - PAGE_MARGIN - 40, summaryY, { align: "right" });
  summaryY += 10;
  if (data.endingCashFlow != null) {
    doc.setFontSize(11);
    const endStr =
      data.endingCashFlow < 0
        ? `- ${formatCurrency(Math.abs(data.endingCashFlow))}`
        : formatCurrency(data.endingCashFlow);
    doc.text(
      `Ending Cash Flow: ${endStr}`,
      PAGE_MARGIN,
      summaryY
    );
  }
  doc.setFont("helvetica", "normal");

  // ----- Receipts section: 4 per page in 2×2 grid (best for readability) -----
  const receiptsWithImages = data.receiptsInOrder.filter(
    (row): row is typeof row & { receipt: { imageData: string } } => row.receipt.imageData != null
  );
  if (receiptsWithImages.length > 0) {
    doc.addPage(); // Start receipts on a new page so they don't overlap the summary
    const totalReceiptPages = Math.ceil(receiptsWithImages.length / RECEIPTS_PER_PAGE);
    const cols = 2;
    const rows = 2;
    const receiptStartY = 22;

    receiptsWithImages.forEach((row, index) => {
      const pageIndex = Math.floor(index / RECEIPTS_PER_PAGE);
      const indexOnPage = index % RECEIPTS_PER_PAGE;
      const col = indexOnPage % cols;
      const rowIdx = Math.floor(indexOnPage / cols);

      if (pageIndex > 0 && indexOnPage === 0) {
        doc.addPage();
      }

      // Page header: draw once per page (first cell only)
      if (indexOnPage === 0) {
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(
          pageIndex === 0 ? "Receipts" : "Receipts (continued)",
          PAGE_MARGIN,
          14
        );
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(
          `Page ${pageIndex + 1} of ${totalReceiptPages} · ${receiptsWithImages.length} receipt(s) in order by transaction`,
          pageW - PAGE_MARGIN,
          14,
          { align: "right" }
        );
      }

      // Cell position (2×2 grid)
      const cellX = PAGE_MARGIN + col * (RECEIPT_CELL_W + RECEIPT_GAP);
      const cellY = receiptStartY + rowIdx * (RECEIPT_CELL_H + RECEIPT_GAP);

      // Light border around cell for separation
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.rect(cellX, cellY, RECEIPT_CELL_W, RECEIPT_CELL_H, "S");

      // Caption: transaction description + amount (wraps within cell)
      const caption = row.entryDescription + " · " + formatCurrency(row.amount);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(caption, cellX + 3, cellY + 5.5, { maxWidth: RECEIPT_CELL_W - 6 });
      doc.setFont("helvetica", "normal");

      // Image area: fixed box, fit image inside preserving aspect ratio
      const imgBoxX = cellX + 2;
      const imgBoxY = cellY + RECEIPT_CAPTION_H;
      const imgBoxW = RECEIPT_IMG_W;
      const imgBoxH = RECEIPT_IMG_H;

      try {
        const mime = row.receipt.imageType ?? "image/jpeg";
        const imgFormat = mime.includes("png") ? "PNG" : "JPEG";
        const dataUrl = row.receipt.imageData.startsWith("data:")
          ? row.receipt.imageData
          : `data:${mime};base64,${row.receipt.imageData}`;
        // jsPDF addImage with fit: scale image to fit inside box (preserve aspect)
        doc.addImage(dataUrl, imgFormat, imgBoxX, imgBoxY, imgBoxW, imgBoxH, undefined, "FAST");
      } catch {
        doc.setFillColor(248, 248, 248);
        doc.rect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, "F");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text("Image unavailable", imgBoxX + imgBoxW / 2, imgBoxY + imgBoxH / 2 - 2, {
          align: "center",
        });
        doc.setTextColor(0, 0, 0);
      }

      // Footer: submitter + purpose (wraps within cell)
      const footerText = row.receipt.submitterName + " — " + row.receipt.purpose;
      doc.setFontSize(7);
      doc.setTextColor(80, 80, 80);
      doc.text(footerText, cellX + 3, cellY + RECEIPT_CELL_H - 3, {
        maxWidth: RECEIPT_CELL_W - 6,
      });
      doc.setTextColor(0, 0, 0);
    });
  }

  return doc;
}

export function downloadPdfReport(
  data: ReportData,
  options: { dateFrom?: string; dateTo?: string; filename?: string } = {}
): void {
  const doc = buildPdfReport(data, { ...options, title: "Finance Report" });
  const name =
    options.filename ??
    `finance-report-${options.dateFrom ?? "all"}-${options.dateTo ?? "all"}.pdf`.replace(
      /\/|\\/g,
      "-"
    );
  doc.save(name);
}

// ----- Activity Log Report -----

export type ActivityLogReportItem = {
  createdAt: Date;
  action: string;
  description: string;
  user: { id: string; name: string | null; image: string | null };
};

/**
 * Builds a PDF for the activity log (date range, table of actions).
 */
export function buildActivityLogPdf(
  items: ActivityLogReportItem[],
  options: { dateFrom?: string; dateTo?: string; title?: string } = {}
): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFontSize(18);
  doc.text(options.title ?? "Activity Log", PAGE_MARGIN, 18);
  doc.setFontSize(10);
  const dateRange =
    options.dateFrom && options.dateTo
      ? `${options.dateFrom} to ${options.dateTo}`
      : options.dateFrom
        ? `From ${options.dateFrom}`
        : options.dateTo
          ? `Up to ${options.dateTo}`
          : "All dates";
  doc.text(`Period: ${dateRange}`, PAGE_MARGIN, 25);
  doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, PAGE_MARGIN, 30);
  doc.text(`Total entries: ${items.length}`, PAGE_MARGIN, 35);

  if (items.length === 0) {
    doc.setFontSize(11);
    doc.text("No activity in the selected period.", PAGE_MARGIN, 45);
    return doc;
  }

  autoTable(doc, {
    startY: 42,
    head: [["Date", "User", "Action", "Description"]],
    body: items.map((item) => [
      new Date(item.createdAt).toLocaleString("en-PH", {
        dateStyle: "short",
        timeStyle: "short",
      }),
      item.user?.name ?? "Unknown",
      item.action,
      item.description,
    ]),
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
    headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 28, overflow: "linebreak" },
      1: { cellWidth: 42, overflow: "linebreak" },
      2: { cellWidth: 22, overflow: "linebreak" },
      3: { cellWidth: "auto", overflow: "linebreak" },
    },
  });

  return doc;
}

export function downloadActivityLogPdf(
  items: ActivityLogReportItem[],
  options: { dateFrom?: string; dateTo?: string; filename?: string } = {}
): void {
  const doc = buildActivityLogPdf(items, { ...options, title: "Activity Log" });
  const name =
    options.filename ??
    `activity-log-${options.dateFrom ?? "all"}-${options.dateTo ?? "all"}.pdf`.replace(/\/|\\/g, "-");
  doc.save(name);
}

/**
 * Builds a project report PDF (accounting-style):
 * 1. Budget plan (budgeted revenue + budgeted expenditures)
 * 2. Actual revenue (collections), then actual expenditures
 * 3. Summary: revenue & expenditure variances, surplus/(deficit)
 * 4. Receipts in order, 4 per page in a 2×2 grid
 */
/** Approximate height (mm) of the full "4. Summary" block so we can enforce lower margin. */
const PROJECT_REPORT_SUMMARY_BLOCK_HEIGHT = 78;

export function buildProjectReportPdf(data: ProjectReportData): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.getPageWidth();
  const pageH = doc.getPageHeight();
  const pageBottom = pageH - PAGE_MARGIN;
  let y = PAGE_MARGIN;

  /** If current y would push content past the lower margin, start a new page and return updated y. */
  function ensureSpace(requiredHeight: number): number {
    if (y + requiredHeight > pageBottom) {
      doc.addPage();
      return PAGE_MARGIN;
    }
    return y;
  }

  // ----- Title & project info -----
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(`Project Report: ${data.project.name}`, PAGE_MARGIN, y);
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString("en-PH")}`, PAGE_MARGIN, y);
  y += 6;
  if (data.project.category) {
    doc.text(`Category: ${data.project.category}`, PAGE_MARGIN, y);
    y += 6;
  }
  if (data.project.eventDate) {
    doc.text(
      `Event Date: ${new Date(data.project.eventDate).toLocaleDateString("en-PH")}`,
      PAGE_MARGIN,
      y
    );
    y += 6;
  }
  doc.text(`Status: ${data.project.status}`, PAGE_MARGIN, y);
  y += 6;
  if (data.project.description) {
    doc.setFontSize(9);
    const descLines = doc.splitTextToSize(
      data.project.description,
      pageW - 2 * PAGE_MARGIN
    );
    doc.text(descLines, PAGE_MARGIN, y);
    y += descLines.length * 5 + 4;
  }
  doc.setFontSize(10);
  y += 4;

  // ----- 1. Budget Plan (Budgeted Revenue + Budgeted Expenditures) -----
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("1. Budget Plan", PAGE_MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  if (data.budgetPlanRows.length === 0) {
    doc.setFontSize(9);
    doc.text("No budget items.", PAGE_MARGIN, y);
    y += 10;
  } else {
    autoTable(doc, {
      startY: y,
      head: [["Item", "Type", "Description", "Budgeted Amount", "Notes"]],
      body: data.budgetPlanRows.map((r) => [
        r.itemName,
        r.type === "income" ? "Revenue" : "Expenditure",
        r.description || "—",
        formatCurrency(r.estimatedAmount),
        r.notes || "—",
      ]),
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      styles: { fontSize: 8, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 30, overflow: "linebreak" },
        1: { cellWidth: 26, overflow: "linebreak" },
        2: { cellWidth: 40, overflow: "linebreak" },
        3: { cellWidth: 36, halign: "right", overflow: "linebreak" },
        4: { cellWidth: 36, overflow: "linebreak" },
      },
    });
    y =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 10;
  }

  // ----- 2. Actual Revenue (sources of funds – standard order: revenue before expenses) -----
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("2. Actual Revenue (Collections)", PAGE_MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  const incomeRows = data.incomeRows ?? [];
  if (incomeRows.length === 0) {
    doc.setFontSize(9);
    doc.text("No collections recorded.", PAGE_MARGIN, y);
    y += 10;
  } else {
    const incomeBody: string[][] = [];
    for (const r of incomeRows) {
      const hasBreakdown = (r.lineItems?.length ?? 0) > 0;
      if (hasBreakdown) {
        incomeBody.push([
          new Date(r.date).toLocaleDateString("en-PH"),
          r.budgetItemName,
          r.description,
          "—",
        ]);
        for (const li of r.lineItems!) {
          incomeBody.push([
            "",
            "",
            "  \u2022 " + li.description,
            formatCurrency(li.amount),
          ]);
        }
      } else {
        incomeBody.push([
          new Date(r.date).toLocaleDateString("en-PH"),
          r.budgetItemName,
          r.description,
          formatCurrency(r.amount),
        ]);
      }
    }
    autoTable(doc, {
      startY: y,
      head: [["Date", "Line Item", "Description", "Amount"]],
      body: incomeBody,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      styles: { fontSize: 8, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
      alternateRowStyles: { fillColor: [240, 252, 240] },
      columnStyles: {
        0: { cellWidth: 24, overflow: "linebreak" },
        1: { cellWidth: 32, overflow: "linebreak" },
        2: { cellWidth: 62, overflow: "linebreak" },
        3: { cellWidth: 40, halign: "right", overflow: "linebreak" },
      },
    });
    y =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 10;
  }

  // ----- 3. Actual Expenditures (uses of funds) -----
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("3. Actual Expenditures", PAGE_MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  if (data.expenditureRows.length === 0) {
    doc.setFontSize(9);
    doc.text("No expenditures recorded.", PAGE_MARGIN, y);
    y += 10;
  } else {
    const expenditureBody: string[][] = [];
    for (const r of data.expenditureRows) {
      const hasBreakdown = (r.lineItems?.length ?? 0) > 0;
      if (hasBreakdown) {
        expenditureBody.push([
          new Date(r.date).toLocaleDateString("en-PH"),
          r.budgetItemName,
          r.description,
          "—",
        ]);
        for (const li of r.lineItems!) {
          expenditureBody.push([
            "",
            "",
            "  \u2022 " + li.description,
            formatCurrency(li.amount),
          ]);
        }
      } else {
        expenditureBody.push([
          new Date(r.date).toLocaleDateString("en-PH"),
          r.budgetItemName,
          r.description,
          formatCurrency(r.amount),
        ]);
      }
    }
    autoTable(doc, {
      startY: y,
      head: [["Date", "Line Item", "Description", "Amount"]],
      body: expenditureBody,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      styles: { fontSize: 8, font: "helvetica", fontStyle: "normal", overflow: "linebreak" },
      headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 24, overflow: "linebreak" },
        1: { cellWidth: 32, overflow: "linebreak" },
        2: { cellWidth: 62, overflow: "linebreak" },
        3: { cellWidth: 40, halign: "right", overflow: "linebreak" },
      },
    });
    y =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y += 10;
  }

  // ----- 4. Summary (Revenue, Expenditures, Surplus/(Deficit)) -----
  // Sum what's in each table; no abs — revenue sum is positive, expenditure sum is negative.
  const totalActualIncome = (data.incomeRows ?? []).reduce((s, r) => s + r.amount, 0);
  const totalActual = (data.expenditureRows ?? []).reduce((s, r) => s + r.amount, 0);

  y = ensureSpace(PROJECT_REPORT_SUMMARY_BLOCK_HEIGHT);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("4. Summary", PAGE_MARGIN, y);
  y += 8;
  doc.setFont("helvetica", "normal");

  const totalIncomeBudget = data.totalIncomeBudget ?? 0;
  const revenueVariance = totalActualIncome - totalIncomeBudget;
  const expenditureVariance = data.totalBudget + totalActual;
  const surplusDeficit = totalActualIncome + totalActual;

  doc.setFontSize(10);
  y = ensureSpace(28); // Revenue block height
  doc.setFont("helvetica", "bold");
  doc.text("Revenue", PAGE_MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.text("  Budgeted Revenue", PAGE_MARGIN, y);
  doc.text(formatCurrency(totalIncomeBudget), pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 6;
  doc.text("  Actual Revenue", PAGE_MARGIN, y);
  doc.text(formatCurrency(totalActualIncome), pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 6;
  doc.text("  Variance", PAGE_MARGIN, y);
  const revVarStr =
    revenueVariance >= 0
      ? `${formatCurrency(revenueVariance)} (Favorable)`
      : `${formatCurrency(revenueVariance)} (Unfavorable)`;
  doc.text(revVarStr, pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 10;

  y = ensureSpace(28); // Expenditures block height
  doc.setFont("helvetica", "bold");
  doc.text("Expenditures", PAGE_MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.text("  Budgeted Expenditures", PAGE_MARGIN, y);
  doc.text(formatCurrency(data.totalBudget), pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 6;
  doc.text("  Actual Expenditures", PAGE_MARGIN, y);
  doc.text(formatCurrency(totalActual), pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 6;
  doc.text("  Variance", PAGE_MARGIN, y);
  const expVarStr =
    expenditureVariance >= 0
      ? `${formatCurrency(expenditureVariance)} (Favorable)`
      : `${formatCurrency(expenditureVariance)} (Unfavorable)`;
  doc.text(expVarStr, pageW - PAGE_MARGIN - 50, y, { align: "right" });
  y += 10;

  y = ensureSpace(8); // Net line height
  doc.setFont("helvetica", "bold");
  doc.text("Net (Revenue minus Expenditures)", PAGE_MARGIN, y);
  const netStr = formatCurrency(surplusDeficit);
  if (surplusDeficit >= 0) doc.setTextColor(16, 130, 80);
  else doc.setTextColor(190, 40, 40);
  doc.text(netStr, pageW - PAGE_MARGIN - 50, y, { align: "right" });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");

  // ----- Receipts section: same 2×2 grid as cashflow report -----
  const projectReceiptsWithImages = data.receiptsInOrder.filter(
    (row): row is typeof row & { receipt: { imageData: string } } => row.receipt.imageData != null
  );
  if (projectReceiptsWithImages.length > 0) {
    doc.addPage();
    const totalReceiptPages = Math.ceil(projectReceiptsWithImages.length / RECEIPTS_PER_PAGE);
    const cols = 2;
    const receiptStartY = 22;

    projectReceiptsWithImages.forEach((row, index) => {
      const pageIndex = Math.floor(index / RECEIPTS_PER_PAGE);
      const indexOnPage = index % RECEIPTS_PER_PAGE;
      const col = indexOnPage % cols;
      const rowIdx = Math.floor(indexOnPage / cols);

      if (pageIndex > 0 && indexOnPage === 0) {
        doc.addPage();
      }

      if (indexOnPage === 0) {
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(
          pageIndex === 0 ? "Receipts" : "Receipts (continued)",
          PAGE_MARGIN,
          14
        );
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(
          `Page ${pageIndex + 1} of ${totalReceiptPages} · ${projectReceiptsWithImages.length} receipt(s)`,
          pageW - PAGE_MARGIN,
          14,
          { align: "right" }
        );
      }

      const cellX = PAGE_MARGIN + col * (RECEIPT_CELL_W + RECEIPT_GAP);
      const cellY = receiptStartY + rowIdx * (RECEIPT_CELL_H + RECEIPT_GAP);

      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.rect(cellX, cellY, RECEIPT_CELL_W, RECEIPT_CELL_H, "S");

      const caption = row.entryDescription + " · " + formatCurrency(row.amount);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(caption, cellX + 3, cellY + 5.5, { maxWidth: RECEIPT_CELL_W - 6 });
      doc.setFont("helvetica", "normal");

      const imgBoxX = cellX + 2;
      const imgBoxY = cellY + RECEIPT_CAPTION_H;
      const imgBoxW = RECEIPT_IMG_W;
      const imgBoxH = RECEIPT_IMG_H;

      try {
        const mime = row.receipt.imageType ?? "image/jpeg";
        const imgFormat = mime.includes("png") ? "PNG" : "JPEG";
        const dataUrl = row.receipt.imageData.startsWith("data:")
          ? row.receipt.imageData
          : `data:${mime};base64,${row.receipt.imageData}`;
        doc.addImage(dataUrl, imgFormat, imgBoxX, imgBoxY, imgBoxW, imgBoxH, undefined, "FAST");
      } catch {
        doc.setFillColor(248, 248, 248);
        doc.rect(imgBoxX, imgBoxY, imgBoxW, imgBoxH, "F");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text("Image unavailable", imgBoxX + imgBoxW / 2, imgBoxY + imgBoxH / 2 - 2, {
          align: "center",
        });
        doc.setTextColor(0, 0, 0);
      }

      const footerText = row.receipt.submitterName + " — " + row.receipt.purpose;
      doc.setFontSize(7);
      doc.setTextColor(80, 80, 80);
      doc.text(footerText, cellX + 3, cellY + RECEIPT_CELL_H - 3, {
        maxWidth: RECEIPT_CELL_W - 6,
      });
      doc.setTextColor(0, 0, 0);
    });
  }

  return doc;
}

export function downloadProjectReportPdf(
  data: ProjectReportData,
  options: { filename?: string } = {}
): void {
  const doc = buildProjectReportPdf(data);
  const safeName = data.project.name.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 80);
  const name =
    options.filename ?? `project-report-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}
