export function resolveAppRoute(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (normalized === '/' || normalized.endsWith('.html')) {
    return normalized;
  }

  if (process.env.NODE_ENV === 'development') {
    return normalized;
  }

  return `${normalized}.html`;
}
