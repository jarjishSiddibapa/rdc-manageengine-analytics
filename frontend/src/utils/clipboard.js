// Copies text. Browsers offer the clipboard API only on https or localhost, so over a network address the older way is used.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;opacity:0';
    // Inside an open dialog the box has to sit in the dialog, or the dialog takes the focus straight back.
    const host = document.activeElement?.closest('.ant-modal') || document.body;
    host.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}
