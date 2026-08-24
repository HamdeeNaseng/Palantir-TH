/**
 * Shell for the nav destinations that are not built yet. Keeps the top nav
 * consistent so the tabs in the mockup are all reachable.
 */
export default function StubLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col overflow-hidden">{children}</div>;
}
