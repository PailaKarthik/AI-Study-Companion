import type { ReactNode } from "react";
import { Fragment, memo } from "react";
import { cn } from "@/lib/utils";
import { parseInline, parseMarkdown, type TextSpan } from "@/lib/markdown";

/**
 * Safe markdown rendering for AI-generated text.
 *
 * Builds React elements from the parsed AST — raw HTML from model output
 * is never interpreted, only displayed as text. Links render only for
 * http(s) targets (enforced by the parser).
 */

function StyledText({ span }: { span: TextSpan }): ReactNode {
  let node: ReactNode = <>{span.text}</>;
  if (span.code) {
    node = <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node}</code>;
  }
  if (span.bold) node = <strong>{node}</strong>;
  if (span.italic) node = <em>{node}</em>;
  if (span.strike) node = <del>{node}</del>;
  if (span.href) {
    node = (
      <a
        href={span.href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-medium underline underline-offset-4"
      >
        {node}
      </a>
    );
  }
  return node;
}

function renderSpans(spans: TextSpan[], keyPrefix: string): ReactNode {
  return spans.map((span, i) => (
    <Fragment key={`${keyPrefix}-${i}`}>
      <StyledText span={span} />
    </Fragment>
  ));
}

export const MarkdownText = memo(function MarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => {
        const key = `b-${i}`;
        switch (block.type) {
          case "heading":
            return (
              <p key={key} className="text-base font-semibold tracking-tight">
                {renderSpans(block.spans, key)}
              </p>
            );
          case "paragraph":
            return (
              <p key={key} className="whitespace-pre-wrap">
                {renderSpans(block.spans, key)}
              </p>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground"
              >
                {renderSpans(block.spans, key)}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "list":
            return block.ordered ? (
              <ol key={key} className="flex list-decimal flex-col gap-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderSpans(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="flex list-disc flex-col gap-1 pl-5">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderSpans(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-lg border">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/60">
                      {block.headers.map((h, j) => (
                        <th
                          key={`${key}-h-${j}`}
                          className="border-b px-2.5 py-1.5 text-left font-semibold"
                        >
                          {renderSpans(parseInline(h), `${key}-h-${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${key}-r-${r}`} className="odd:bg-muted/20">
                        {row.map((cell, c) => (
                          <td
                            key={`${key}-r-${r}-${c}`}
                            className="border-b px-2.5 py-1.5 align-top last:border-b-0"
                          >
                            {renderSpans(parseInline(cell), `${key}-r-${r}-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "rule":
            return <hr key={key} className="border-muted" />;
        }
      })}
    </div>
  );
});
