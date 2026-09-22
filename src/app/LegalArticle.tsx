import type { ReactNode } from "react";
import type { LegalBlock, LegalDoc } from "@/lib/legal";

/**
 * Renders one legal document (see src/lib/legal.ts) in the site's paper/ink
 * voice: mono eyebrow and date, display title, the day-arc, then a readable
 * measure of headed sections. Fact sheets (publisher, host) are definition
 * lists with mono labels, so the parts that are data read as data.
 */

const linkClass =
  "text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-ink break-words";

/** [text](href) inside a string becomes an anchor; everything else is text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={m[2]} className={linkClass}>
        {m[1]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Block({ block }: { block: LegalBlock }) {
  if ("p" in block) {
    return <p className="mt-4 leading-relaxed text-ink">{inline(block.p)}</p>;
  }
  if ("ul" in block) {
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-ink marker:text-ink/40">
        {block.ul.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="mt-4 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">
      {block.dl.map(([label, value]) => (
        <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
          <dt className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-ink/70 sm:pt-1">
            {label}
          </dt>
          <dd className="leading-relaxed text-ink">{inline(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LegalArticle({ doc }: { doc: LegalDoc }) {
  const showContents = doc.sections.length > 5;
  return (
    <main className="flex-1 mx-auto w-full max-w-prose px-6 py-14">
      <article>
        <header>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-ink/70">
            Booking · {doc.kind}
          </p>
          <h1 className="mt-2 text-4xl sm:text-5xl font-semibold tracking-tight text-ink">
            {doc.title}
          </h1>
          <div className="day-arc mt-6 w-24" />
          <p className="mt-6 font-mono text-xs tabular-nums text-ink/70">
            {doc.updatedLabel}{" "}
            <time dateTime={doc.updated} className="text-ink">
              {doc.updated}
            </time>
          </p>
          <p className="mt-4 leading-relaxed text-ink/70">{doc.intro}</p>
        </header>

        {showContents && (
          <nav aria-label={doc.contentsLabel} className="mt-8 rounded-xl border border-ink/10 bg-white px-5 py-4">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-ink/70">
              {doc.contentsLabel}
            </p>
            <ol className="mt-2 columns-1 sm:columns-2 gap-6 text-sm">
              {doc.sections.map((s) => (
                <li key={s.id} className="py-0.5">
                  <a href={`#${s.id}`} className={linkClass}>
                    {s.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-8">
            <h2 id={`${s.id}-h`} className="text-xl font-semibold tracking-tight text-ink">
              {s.heading}
            </h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
