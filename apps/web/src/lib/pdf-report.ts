import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportEntry = {
  id: string;
  date: Date;
  description: string;
  category: string;
  amount: number;
  currency: string;
  receiptsCount: number;
  accountEntry: { id: string; description: string; account: string } | null;
};

export type ReportReceiptRow = {
  entryId: string;
  entryDate: Date;
  entryDescription: string;
  amount: number;
  receipt: {
    id: string;
    imageData: string;
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

/** Format as PHP amount, no ± or sign character (use separate minus if needed). */
function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const num = abs.toLocaleString("en-PH", {
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
  autoTable(doc, {
    startY: tableStartY,
    head: [["Date", "Description", "Category", "Credit", "Debit"]],
    body: data.entries.map((e) => [
      new Date(e.date).toLocaleDateString("en-PH"),
      e.description.slice(0, 42) + (e.description.length > 42 ? "…" : ""),
      e.category.slice(0, 14) + (e.category.length > 14 ? "…" : ""),
      e.amount > 0 ? formatCurrency(e.amount) : "—",
      e.amount < 0 ? formatCurrency(Math.abs(e.amount)) : "—",
    ]),
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, font: "helvetica", fontStyle: "normal" },
    headStyles: { fillColor: [66, 66, 66], fontSize: 8, font: "helvetica", fontStyle: "normal" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 24, font: "helvetica", fontStyle: "normal" },
      1: { cellWidth: 50, font: "helvetica", fontStyle: "normal", overflow: "ellipsize" },
      2: { cellWidth: 28, font: "helvetica", fontStyle: "normal", overflow: "ellipsize" },
      3: { cellWidth: 38, halign: "right", font: "helvetica", fontStyle: "normal", overflow: "ellipsize" },
      4: { cellWidth: 38, halign: "right", font: "helvetica", fontStyle: "normal", overflow: "ellipsize" },
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
  if (data.receiptsInOrder.length > 0) {
    doc.addPage(); // Start receipts on a new page so they don't overlap the summary
    const totalReceiptPages = Math.ceil(data.receiptsInOrder.length / RECEIPTS_PER_PAGE);
    const cols = 2;
    const rows = 2;
    const receiptStartY = 22;

    data.receiptsInOrder.forEach((row, index) => {
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
          `Page ${pageIndex + 1} of ${totalReceiptPages} · ${data.receiptsInOrder.length} receipt(s) in order by transaction`,
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

      // Caption: transaction description + amount (single line, truncated)
      const caption =
        (row.entryDescription.length > 32
          ? row.entryDescription.slice(0, 32) + "…"
          : row.entryDescription) +
        " · " +
        formatCurrency(row.amount);
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

      // Footer: submitter + purpose (small, one line if possible)
      const footerText =
        row.receipt.submitterName +
        " — " +
        (row.receipt.purpose.length > 36 ? row.receipt.purpose.slice(0, 36) + "…" : row.receipt.purpose);
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
