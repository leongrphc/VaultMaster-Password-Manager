/** Only a saved hostname and its subdomains can receive that login. */
export function scoreHostMatch(activePage: { hostname: string } | null, loginUrl?: string) {
  if (!activePage || !loginUrl) return -5;
  try {
    const saved = new URL(loginUrl);
    if (!["https:", "http:"].includes(saved.protocol)) return -5;
    const hostname = saved.hostname.replace(/^www\./, "").toLowerCase();
    return activePage.hostname === hostname || activePage.hostname.endsWith(`.${hostname}`)
      ? 3
      : -5;
  } catch {
    return -5;
  }
}
