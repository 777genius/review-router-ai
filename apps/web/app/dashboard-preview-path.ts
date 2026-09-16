export function isDashboardOperatorPreviewPath(
  pathname: string | null,
): boolean {
  return (pathname ?? "").startsWith("/dashboard/hosted-pool-preview");
}
