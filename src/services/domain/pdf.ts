import { todayJakarta } from '../../utils/format';

export async function exportTableToPdf(params: {
  filename: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(`KonveksiOps — ${params.title}`, 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const metaLine = params.subtitle
    ? `${params.subtitle} · Dicetak ${todayJakarta()} (WIB)`
    : `Dicetak ${todayJakarta()} (WIB)`;
  doc.text(metaLine, 14, 22);

  autoTable(doc, {
    startY: 27,
    head: [params.headers],
    body: params.rows.map((r) => r.map((cell) => String(cell))),
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  const safeName = params.filename.endsWith('.pdf') ? params.filename : `${params.filename}.pdf`;
  doc.save(safeName);
}
