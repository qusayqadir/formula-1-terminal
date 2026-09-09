/** Markdown — a small, dependency-free renderer for the subset of Markdown the
 *  chatbot actually emits: ATX headings (#…######), bold/italic, inline code,
 *  bullet + ordered lists, horizontal rules, and paragraphs with soft line
 *  breaks. Styled to the terminal design system (ink prose, mono inline code,
 *  hairline rules) so an assistant answer reads like the rest of the app rather
 *  than dumping literal `**` and `#` on screen.
 *
 *  This is deliberately not a full CommonMark parser — no tables, blockquotes,
 *  or fenced code blocks, because the model doesn't produce them here. If that
 *  changes, prefer swapping in a real parser over growing this one. */
import { Fragment, type ReactNode } from "react";

/** Inline pass: **bold**, *italic* / _italic_, and `code`. Runs a single
 *  left-to-right scan so nested/adjacent spans resolve without regex soup. */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let buf = "";
  let key = 0;
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // inline code — literal, no inner formatting
    if (rest[0] === "`") {
      const end = rest.indexOf("`", 1);
      if (end > 0) {
        flush();
        out.push(
          <code
            key={key++}
            className="rounded bg-ink/[0.06] px-1 py-px font-mono text-[0.92em] text-ink"
          >
            {rest.slice(1, end)}
          </code>,
        );
        i += end + 1;
        continue;
      }
    }

    // bold — ** or __
    const bold = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" : null;
    if (bold) {
      const end = rest.indexOf(bold, 2);
      if (end > 1) {
        flush();
        out.push(
          <strong key={key++} className="font-semibold text-ink">
            {renderInline(rest.slice(2, end))}
          </strong>,
        );
        i += end + 2;
        continue;
      }
    }

    // italic — single * or _ (not part of a ** / __ run)
    if ((rest[0] === "*" || rest[0] === "_") && rest[1] !== rest[0]) {
      const marker = rest[0];
      const end = rest.indexOf(marker, 1);
      if (end > 0) {
        flush();
        out.push(
          <em key={key++} className="italic">
            {renderInline(rest.slice(1, end))}
          </em>,
        );
        i += end + 1;
        continue;
      }
    }

    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 mb-1.5 text-[15px] font-semibold tracking-tight text-ink first:mt-0",
  2: "mt-4 mb-1.5 text-[14px] font-semibold tracking-tight text-ink first:mt-0",
  3: "mt-3 mb-1 text-[13px] font-semibold text-ink first:mt-0",
  4: "mt-3 mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-sub first:mt-0",
};

/** Block pass: split into paragraphs, headings, lists, and rules. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join("\n");
    blocks.push(
      <p key={key++} className="text-[13px] leading-relaxed text-ink">
        {text.split("\n").map((ln, idx, arr) => (
          <Fragment key={idx}>
            {renderInline(ln)}
            {idx < arr.length - 1 && <br />}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      i += 1;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push(<hr key={key++} className="my-3 border-stroke" />);
      i += 1;
      continue;
    }

    // heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const cls = HEADING_CLASS[level] ?? HEADING_CLASS[4];
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(heading[2].trim())}
        </p>,
      );
      i += 1;
      continue;
    }

    // list — consume a run of contiguous bullet/ordered items
    const isBullet = /^[-*+]\s+/.test(trimmed);
    const isOrdered = /^\d+\.\s+/.test(trimmed);
    if (isBullet || isOrdered) {
      flushPara();
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const bulletMatch = /^[-*+]\s+(.*)$/.exec(t);
        const orderedMatch = /^\d+\.\s+(.*)$/.exec(t);
        const m = isOrdered ? orderedMatch : bulletMatch;
        if (!m) break;
        items.push(
          <li key={items.length} className="text-[13px] leading-relaxed text-ink">
            {renderInline(m[1])}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        isOrdered ? (
          <ol key={key++} className="ml-4 list-decimal space-y-0.5 marker:text-mut">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="ml-4 list-disc space-y-0.5 marker:text-mut">
            {items}
          </ul>
        ),
      );
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();

  return <div className={`space-y-2 ${className ?? ""}`}>{blocks}</div>;
}
