import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ARABIC = /[\u0600-\u06FF]/;

function hasArabic(node: unknown): boolean {
  if (typeof node === "string") return ARABIC.test(node);
  if (Array.isArray(node)) return node.some(hasArabic);
  if (node && typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    return hasArabic((node as { props?: { children?: unknown } }).props?.children);
  }
  return false;
}

export function AnswerMarkdown({ content }: { content: string }) {
  return (
    <div className="answer text-[0.95rem] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) =>
            hasArabic(children) && !String(children).match(/[a-zA-Z]{6,}/) ? (
              <p dir="auto" className="font-arabic text-[1.1em] leading-loose">
                {children}
              </p>
            ) : (
              <p>{children}</p>
            ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
