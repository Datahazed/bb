import { HugeiconsIcon } from "@hugeicons/react";
import { Link04Icon } from "@hugeicons/core-free-icons";

import type { ApiMemberDoc, ApiSymbolDoc } from "./model";
import { DocText } from "./doc-text";
import { CodeBlock, CopyButton, ExperimentalBadge, KindBadge } from "./ui";

function MemberRow({
  symbolName,
  member,
}: {
  symbolName: string;
  member: ApiMemberDoc;
}) {
  const anchorId = `${symbolName}.${member.name}`;
  return (
    <li
      id={anchorId}
      className="scroll-mt-20 border-t border-border-hairline px-3.5 py-3 first:border-t-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        {member.experimental ? <ExperimentalBadge /> : null}
        <code className="font-mono text-xs font-semibold text-foreground">
          {member.name}
        </code>
        {member.optional ? (
          <span className="font-mono text-2xs text-subtle-foreground">
            optional
          </span>
        ) : null}
        <a
          href={`#${anchorId}`}
          aria-label={`Link to ${symbolName}.${member.name}`}
          className="text-subtle-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/member:opacity-100 [li:hover_&]:opacity-100"
        >
          <HugeiconsIcon icon={Link04Icon} className="size-3" />
        </a>
      </div>
      <pre className="bb-code-highlight mt-1.5 overflow-x-auto">
        <code className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">
          {member.signature}
        </code>
      </pre>
      {member.doc ? (
        <DocText
          text={member.doc}
          className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
        />
      ) : null}
    </li>
  );
}

export function SymbolArticle({
  symbol,
  importPath,
}: {
  symbol: ApiSymbolDoc;
  importPath: string;
}) {
  const hasMembers =
    (symbol.kind === "interface" || symbol.kind === "class") &&
    symbol.members.length > 0;
  return (
    <article id={symbol.name} className="group scroll-mt-20">
      <div className="flex flex-wrap items-center gap-2">
        {symbol.experimental ? <ExperimentalBadge /> : null}
        <h3 className="break-all font-mono text-sm font-semibold text-foreground">
          {symbol.name}
        </h3>
        <KindBadge kind={symbol.kind} />
        <a
          href={`#${symbol.name}`}
          aria-label={`Link to ${symbol.name}`}
          className="text-subtle-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <HugeiconsIcon icon={Link04Icon} className="size-3.5" />
        </a>
        <span className="flex-1" />
        <span className="hidden items-center gap-1 sm:inline-flex">
          <code className="font-mono text-2xs text-subtle-foreground">
            {importPath}
          </code>
          <CopyButton
            text={`import type { ${symbol.name} } from "${importPath}";`}
            label="Copy import"
          />
        </span>
      </div>

      {symbol.doc ? (
        <DocText
          text={symbol.doc}
          className="mt-2 text-sm leading-relaxed text-muted-foreground"
        />
      ) : null}

      <CodeBlock code={symbol.signature} lang="ts" className="my-2.5" />

      {hasMembers ? (
        <ul className="mt-2.5 list-none rounded-md border border-border">
          {symbol.members.map((member, index) => (
            <MemberRow
              key={`${member.name}-${index}`}
              symbolName={symbol.name}
              member={member}
            />
          ))}
        </ul>
      ) : null}
    </article>
  );
}
