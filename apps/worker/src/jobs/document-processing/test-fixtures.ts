import { deflateSync } from "node:zlib";

/**
 * Minimal valid single/multi-page text PDFs for document-pipeline tests.
 * Helvetica Type1 (no embedding needed); pdfjs parses these headless.
 */
export function buildTextPdf(pages: string[]): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  const push = (body: string): void => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  const pageRefs = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  push("<< /Type /Catalog /Pages 2 0 R >>");
  push(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`);
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const cid = 4 + i * 2;
    const lines = text
      .split("\n")
      .map((l, li) => `BT /F1 12 Tf 72 ${720 - li * 16} Td (${l}) Tj ET`)
      .join("\n");
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    offsets.push(out.length);
    out += `${cid} 0 obj\n<< /Length ${lines.length} >>\nstream\n${lines}\nendstream\nendobj\n`;
  });
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xrefAt = out.length;
  const total = offsets.length + 1;
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/** Single-page PDF with one 3x2 RGB FlateDecode image XObject, no text. */
export function buildImageOnlyPdf(): Buffer {
  const width = 3;
  const height = 2;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    raw[i * 3] = (i * 40) % 256;
    raw[i * 3 + 1] = 30;
    raw[i * 3 + 2] = 200;
  }
  const img = deflateSync(raw);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  const push = (body: string): void => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); // 2
  const content = "q 100 0 0 100 50 600 cm /Im1 Do Q";
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> >>`
  ); // 3
  offsets.push(out.length);
  out += `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  offsets.push(out.length);
  const imgHead =
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${img.length} /Filter /FlateDecode >>\nstream\n`;
  out = Buffer.concat([
    Buffer.from(out, "latin1"),
    Buffer.from(imgHead, "latin1"),
    img,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]).toString("latin1");
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 6
  const xrefAt = out.length;
  const total = offsets.length + 1;
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/**
 * Single-page PDF with one JPEG (DCTDecode) image XObject, no text —
 * the scanned-PDF shape. pdfjs hands JPEG streams through
 * still-encoded, so this exercises the native-decode path (a raw-only
 * extractor skips these as "unknown layout").
 */
export function buildJpegImagePdf(jpeg: Buffer, width: number, height: number): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  const push = (body: string): void => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); // 2
  const content = "q 100 0 0 100 50 600 cm /Im1 Do Q";
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> /Font << /F1 6 0 R >> >> >>`
  ); // 3
  offsets.push(out.length);
  out += `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  offsets.push(out.length);
  const imgHead =
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${jpeg.length} /Filter /DCTDecode >>\nstream\n`;
  out = Buffer.concat([
    Buffer.from(out, "latin1"),
    Buffer.from(imgHead, "latin1"),
    jpeg,
    Buffer.from("\nendstream\nendobj\n", "latin1"),
  ]).toString("latin1");
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 6
  const xrefAt = out.length;
  const total = offsets.length + 1;
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
