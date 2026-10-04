// Re-mounts on every navigation → each page enters with the same animation.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
