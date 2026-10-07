import { Children, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Link } from "react-router";

import { resolveDocHref, slugifyHeading } from "./links";
import type { DocsLocale } from "./content";

/* Minimal structural view of the hast nodes react-markdown hands to component
   overrides — avoids importing hast types that only resolve transitively. */
interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function nodeText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(nodeText).join("");
}

const CALLOUTS = {
  TIP: { icon: "💡", title: "Tip", className: "docs-callout-tip" },
  INFO: { icon: "ℹ️", title: "Info", className: "docs-callout-info" },
  WARNING: { icon: "⚠️", title: "Warning", className: "docs-callout-warning" },
  DANGER: { icon: "⛔", title: "Danger", className: "docs-callout-danger" },
} as const;

type CalloutKind = keyof typeof CALLOUTS;

function Callout({ kind, title, children }: { kind: CalloutKind; title: string; children: ReactNode }) {
  const preset = CALLOUTS[kind];
  return (
    <div className={`docs-callout ${preset.className}`}>
      <p className="docs-callout-title">
        <span aria-hidden="true">{preset.icon}</span> {title || preset.title}
      </p>
      {children}
    </div>
  );
}

function CodeBlock({ language, text, children }: { language: string; text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — copy simply stays disabled */
    }
  };
  return (
    <div className="docs-code-block">
      <div className="docs-code-header">
        <span className="docs-code-lang">{language || "text"}</span>
        <button type="button" onClick={copy} className="docs-code-copy">
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function heading(level: number) {
  return function MarkdownHeading({ node, children }: { node?: HastNode; children?: ReactNode }) {
    const Tag = (`h${level}` as unknown) as "h2";
    const id = slugifyHeading(nodeText(node));
    return (
      <Tag id={id} className="docs-heading">
        <a href={`#${id}`} className="docs-heading-anchor" aria-label="Link to this section">
          #
        </a>
        {children}
      </Tag>
    );
  };
}

export function Markdown({
  markdown,
  locale,
  slug,
}: {
  markdown: string;
  locale: DocsLocale;
  slug: string;
}) {
  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          h1: heading(1),
          h2: heading(2),
          h3: heading(3),
          h4: heading(4),
          h5: heading(5),
          h6: heading(6),
          a({ href = "", children }) {
            const resolved = resolveDocHref(href, locale, slug);
            if (resolved.kind === "internal") {
              return (
                <Link to={resolved.path} className="docs-link">
                  {children}
                </Link>
              );
            }
            if (resolved.kind === "anchor") {
              return (
                <a href={resolved.hash} className="docs-link">
                  {children}
                </a>
              );
            }
            return (
              <a href={resolved.url} target="_blank" rel="noreferrer" className="docs-link docs-link-external">
                {children}
              </a>
            );
          },
          blockquote({ node, children }: { node?: HastNode; children?: ReactNode }) {
            // Leading whitespace text nodes (\n between block children) come
            // first — find the first actual element.
            const first = node?.children?.find((child) => child.tagName !== undefined);
            if (first?.tagName === "p") {
            const marker = /^\[!(TIP|INFO|WARNING|DANGER)\][ \t]*([^\n]*)/.exec(nodeText(first).trim());
            if (marker) {
              // Drop the marker's own <p> (whitespace text nodes precede it,
              // so positional slicing is unreliable).
              let dropped = false;
              const body = Children.toArray(children).filter((child) => {
                if (!dropped && isValidElement(child) && child.type === "p") {
                  dropped = true;
                  return false;
                }
                return true;
              });
              return (
                <Callout kind={marker[1] as CalloutKind} title={marker[2]}>
                  {body}
                </Callout>
              );
            }
            }
            return <blockquote className="docs-quote">{children}</blockquote>;
          },
          pre({ node, children }: { node?: HastNode; children?: ReactNode }) {
            const code = node?.children?.find((child) => child.tagName === "code");
            const className = String(code?.properties?.className ?? "");
            const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
            return (
              <CodeBlock language={language} text={nodeText(code)}>
                {children}
              </CodeBlock>
            );
          },
          code({ className, children }) {
            return <code className={className ?? undefined}>{children}</code>;
          },
          table({ children }) {
            return (
              <div className="docs-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
          img({ src = "", alt = "" }) {
            return <img src={src} alt={alt} className="docs-img" loading="lazy" />;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
