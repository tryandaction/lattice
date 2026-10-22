/** Public entry points. A release listing does not attest that any build is current. */
export const LATTICE_WEB_URL = "https://lattice-apq-7xj.pages.dev/";
export const LATTICE_DESKTOP_RELEASES_URL = "https://github.com/tryandaction/lattice/releases";

/** Stop forwarding the retired hosted entry while preserving self-hosted deployments. */
export function currentProductWebUrl(input: string): string {
  const url = new URL(input);
  if (url.hostname === "lattice-apq.pages.dev") {
    const current = new URL(LATTICE_WEB_URL);
    url.protocol = current.protocol;
    url.host = current.host;
  }
  return url.toString();
}
