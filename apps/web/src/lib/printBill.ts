/**
 * PRINT THE BILL — the real document, not a screenshot of the page.
 *
 * The portal used to print by calling window.print() on the whole page and
 * letting print CSS hide everything except a receipt-shaped div. That works
 * until it doesn't: what came out was the DOM as this browser happened to
 * style it, while the PHONE printed the string renderBillHtml produces. Two
 * documents claiming to be one bill, and they agree right up until one of
 * them changes.
 *
 * So the portal prints the same string. A hidden iframe is given the exact
 * HTML the app hands expo-print, and that iframe is what the print dialog
 * sees -- so a bill from the counter PC and a bill from the phone are the
 * same document, character for character.
 *
 * WHY THIS IS RESOLUTION-INDEPENDENT. The document is text and CSS, not an
 * image: the printer rasterises it at whatever DPI it runs at, so a thermal
 * roll at 203dpi and an A4 laser at 1200dpi each get sharp type rather than a
 * scaled bitmap. The template sizes itself in mm and points and lets the
 * paper decide the width, which is what makes it ratio-agnostic -- an 80mm
 * roll and an A4 sheet both print a correct bill without a separate layout.
 */

/** How long to leave the iframe alive after print() returns. Chrome resolves
 *  print() when the dialog opens, not when it closes, so removing the node
 *  immediately can cancel the job. */
const CLEANUP_MS = 60_000;

export function printBillHtml(html: string): void {
  // A same-origin about:blank iframe: no network, no route, and the document
  // is written directly so nothing can be substituted between here and the
  // printer.
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const done = () => { try { frame.remove(); } catch { /* already gone */ } };

  frame.onload = () => {
    try {
      const win = frame.contentWindow;
      if (!win) { done(); return; }
      win.focus();
      win.print();
    } catch {
      // A blocked print is not worth an error page; the owner can use the
      // browser's own Print on the preview instead.
    } finally {
      setTimeout(done, CLEANUP_MS);
    }
  };

  const doc = frame.contentDocument;
  if (!doc) { done(); return; }
  doc.open();
  doc.write(html);
  doc.close();
}

/**
 * The same document, opened for the owner to look at rather than print.
 * Useful when a browser blocks programmatic printing.
 */
export function openBillHtml(html: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  // Revoking too early kills the load in some browsers; a minute is ample.
  setTimeout(() => URL.revokeObjectURL(url), CLEANUP_MS);
  if (!w) URL.revokeObjectURL(url);
}
