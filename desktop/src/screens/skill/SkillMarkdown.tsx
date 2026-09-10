import type { ReactNode } from 'react';
import { Children, Fragment } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** The plain text of a node's children, used only to tell `[https://x](https://x)` from a labelled link. */
function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => (typeof child === 'string' ? child : '')).join('').trim();
}
/** Heading overrides forward the incoming class (remark-gfm's footnote header carries `sr-only`). */
function heading(Tag: 'h2'|'h3'|'h4'|'h5'|'h6', own: string) {
  return function Heading({children, className}: {children?: ReactNode; className?: string | undefined}) {
    return <Tag className={className ? own + ' ' + className : own}>{children}</Tag>;
  };
}

/**
 * Markdown → the SKILL.md tab's drawn vocabulary. `h2`, `p`, ordered/unordered lists and fenced code re-use the
 * board classes verbatim (`.md-h2`, `.md-p`, `.md-list`, `.md-code`); everything the canvas never drew is derived
 * from the same tokens in skill.css. A document H1 becomes `<h2 class="md-h1">` so the page keeps exactly one
 * <h1> (the skill name); the *class* still names the authored level, so the look follows the document.
 * Links and images are inert on purpose: `opener:allow-open-url` is scoped to github.com/discord.gg
 * (src-tauri/capabilities/default.json), a markdown <a> has no click handler and would navigate the whole webview
 * away, and a remote <img> in team-repo text is a tracking beacon under `csp: null`.
 * Sibling: `src/lib/body-excerpt.ts` drops *any* leading H1 for the card excerpt; `./skill-markdown.ts` drops only
 * the name-matching one for this document. Keep the two in step.
 */
const MARKDOWN: Components = {
  h1: heading('h2','md-h1'), h2: heading('h2','md-h2'), h3: heading('h3','md-h3'),
  h4: heading('h4','md-h4'), h5: heading('h5','md-h5'), h6: heading('h6','md-h6'),
  p: ({children}) => <p className="md-p">{children}</p>,
  hr: () => <hr className="md-hr"/>,
  blockquote: ({children}) => <blockquote className="md-quote">{children}</blockquote>,
  // `start` carries a list that does not begin at 1 (`3. …`); the CSS counter has to be seeded to match.
  ol: ({children, start}) => <ol className="md-list" {...(typeof start === 'number' && start !== 1 ? {start, style: {counterReset: `md-item ${start - 1}`}} : {})}>{children}</ol>,
  ul: ({children}) => <ul className="md-list">{children}</ul>,
  // The body wrapper keeps a nested list out of the flex row that carries the marker.
  li: ({children, className}) => <li {...(className ? {className} : {})}><div className="md-li-body">{children}</div></li>,
  pre: ({children}) => <pre className="md-code">{children}</pre>,
  table: ({children}) => <div className="md-table-wrap"><table className="md-table">{children}</table></div>,
  a: ({children, href}) => {
    const url = typeof href === 'string' ? href.trim() : '';
    // '' is a destination react-markdown already neutralised (javascript:, data:, file:, vbscript:);
    // '#…' is an in-document anchor, including remark-gfm's own footnote plumbing.
    if (url === '' || url.startsWith('#')) return <Fragment>{children}</Fragment>;
    return textOf(children) === url
      ? <span className="md-url">{url}</span>
      : <span className="md-link">{children} <span className="md-url">{url}</span></span>;
  },
  img: ({src, alt}) => <span className="md-img">{alt ? `image · ${alt}` : 'image'}<span className="md-url">{typeof src === 'string' ? src : ''}</span></span>,
};

export function SkillMarkdown({markdown}: {markdown: string}) {
  return <div className="md-doc"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>{markdown}</ReactMarkdown></div>;
}
