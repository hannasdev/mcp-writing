import zlib from "node:zlib";

export function extractPdfFlateText(pdfBytes) {
  const markerStart = Buffer.from("stream\n", "latin1");
  const markerEnd = Buffer.from("\nendstream", "latin1");
  const chunks = [];
  let offset = 0;

  while (offset < pdfBytes.length) {
    const start = pdfBytes.indexOf(markerStart, offset);
    if (start === -1) break;
    const dataStart = start + markerStart.length;
    const end = pdfBytes.indexOf(markerEnd, dataStart);
    if (end === -1) break;
    const compressed = pdfBytes.subarray(dataStart, end);
    try {
      chunks.push(zlib.inflateSync(compressed).toString("latin1"));
    } catch {
      // Non-flate or non-text stream; ignore.
    }
    offset = end + markerEnd.length;
  }
  return chunks.join("\n");
}

export function decodePdfHexText(inflatedPdfText) {
  const parts = [];
  const re = /<([0-9A-Fa-f]+)>/g;
  let match;
  while ((match = re.exec(inflatedPdfText)) !== null) {
    const hex = match[1].length % 2 === 0 ? match[1] : `0${match[1]}`;
    parts.push(Buffer.from(hex, "hex").toString("latin1"));
  }
  return parts.join("");
}