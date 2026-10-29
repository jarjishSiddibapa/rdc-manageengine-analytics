// ManageEngine's own error text arrives as 'ManageEngine API returned HTTP 400: {"error_description":"...", ...}'. Show people the sentence.
export function friendlyError(text) {
  const raw = String(text || '');
  const json = /\{.*\}/s.exec(raw)?.[0];
  if (json) {
    try {
      const data = JSON.parse(json);
      const said = data.error_description || data.message || data.error;
      if (said) {
        const limited = /too many requests|try again after some time/i.test(said);
        return limited ? `ManageEngine is limiting requests: "${said}" It continues by itself, or press the button again in a few minutes.` : `ManageEngine said: ${said}`;
      }
    } catch { /* not JSON after all: show it as it is */ }
  }
  return raw;
}
