import { useSearchParams } from "react-router-dom";

export function HtmlPreviewView() {
  const [searchParams] = useSearchParams();
  const sourceUrl = searchParams.get("src");

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">bb HTML preview</p>
          <p className="text-xs text-muted-foreground">
            This workspace content is untrusted; do not enter passwords or
            secrets.
          </p>
        </div>
        <a className="shrink-0 text-sm text-primary hover:underline" href="/">
          Back to bb
        </a>
      </header>
      {sourceUrl ? (
        <iframe
          className="min-h-0 flex-1 border-0 bg-background"
          sandbox="allow-scripts"
          src={sourceUrl}
          title="Untrusted HTML preview"
        />
      ) : (
        <div className="p-4 text-sm text-muted-foreground" role="alert">
          Preview URL is missing.
        </div>
      )}
    </main>
  );
}
