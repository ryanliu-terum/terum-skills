import { afterEach,expect,it } from 'vitest';
import { cleanup,render } from '@testing-library/react';
import { SkillMarkdown } from './SkillMarkdown';

afterEach(cleanup);

it("maps ## to the board's own h2 class",()=>{
  render(<SkillMarkdown markdown={'## Steps'}/>);
  const heading=document.querySelector('.md-doc > h2');
  expect(heading).toHaveAttribute('class','md-h2');
  expect(heading?.textContent).toBe('Steps');
});
it('renders a document H1 as h2.md-h1 so the page keeps one h1',()=>{
  render(<SkillMarkdown markdown={'# Title'}/>);
  expect(document.querySelector('.md-h1')?.tagName).toBe('H2');
  expect(document.querySelector('.md-h1')).toHaveTextContent('Title');
  expect(document.querySelectorAll('h1')).toHaveLength(0);
});
it('maps h3 through h6 to the derived ramp',()=>{
  render(<SkillMarkdown markdown={'### a\n\n#### b\n\n##### c\n\n###### d'}/>);
  for(const [level,text] of [[3,'a'],[4,'b'],[5,'c'],[6,'d']] as const){
    expect(document.querySelector(`h${level}.md-h${level}`)).toHaveTextContent(text);
  }
});
it('gives paragraphs the board class and leaves emphasis as real elements',()=>{
  render(<SkillMarkdown markdown={'Plain **b** and *i* and ~~s~~ and `x`.'}/>);
  expect(document.querySelector('p')).toHaveClass('md-p');
  for(const tag of ['strong','em','del'])expect(document.querySelectorAll(tag)).toHaveLength(1);
  const code=document.querySelector('code');
  expect(code).toHaveTextContent('x');
  expect(code?.closest('pre')).toBeNull();
});
it('renders ordered and unordered lists as md-list rows with a body wrapper',()=>{
  const {rerender}=render(<SkillMarkdown markdown={'1. a\n2. b'}/>);
  for(const [tag,markdown] of [['ol','1. a\n2. b'],['ul','- a\n- b']] as const){
    rerender(<SkillMarkdown markdown={markdown}/>);
    const list=document.querySelector(`${tag}.md-list`);
    expect(list).not.toBeNull();
    const items=list!.querySelectorAll('li');
    expect(items).toHaveLength(2);
    for(const item of items){
      expect(item.children).toHaveLength(1);
      expect(item.firstElementChild?.tagName).toBe('DIV');
      expect(item.firstElementChild).toHaveClass('md-li-body');
    }
  }
});
it('seeds the CSS counter when an ordered list does not start at 1',()=>{
  const {rerender}=render(<SkillMarkdown markdown={'3. a\n4. b'}/>);
  const list=document.querySelector('ol');
  expect(list).toHaveAttribute('start','3');
  expect(list?.style.counterReset).toBe('md-item 2');
  rerender(<SkillMarkdown markdown={'1. a'}/>);
  expect(document.querySelector('ol')).not.toHaveAttribute('start');
  expect(document.querySelector('ol')?.style.counterReset).toBe('');
});
it('keeps a nested list inside the parent item body',()=>{
  render(<SkillMarkdown markdown={'1. a\n   - x\n   - y'}/>);
  const list=document.querySelector('.md-li-body > ul.md-list');
  expect(list).not.toBeNull();
  expect(list?.parentElement).toHaveClass('md-li-body');
  expect(list?.querySelectorAll('li')).toHaveLength(2);
});
it('renders a GFM task item with a disabled checkbox',()=>{
  render(<SkillMarkdown markdown={'- [x] done\n- [ ] todo'}/>);
  const items=document.querySelectorAll('li.task-list-item');
  expect(items).toHaveLength(2);
  const checkbox=items[0]!.querySelector('input[type=checkbox]');
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(checkbox?.parentElement).toHaveClass('md-li-body');
  expect(items[1]!.querySelector('input')).not.toBeChecked();
  expect(items[1]!.querySelector('input')).toBeDisabled();
});
it('renders a fenced block as pre.md-code and keeps its language and newline',()=>{
  render(<SkillMarkdown markdown={'```bash\nverify.sh\n```'}/>);
  expect(document.querySelector('pre.md-code > code.language-bash')?.textContent).toBe('verify.sh\n');
});
it('renders a thematic break as hr.md-hr',()=>{
  render(<SkillMarkdown markdown={'a\n\n---\n\nb'}/>);
  expect(document.querySelectorAll('hr')).toHaveLength(1);
  expect(document.querySelector('hr')).toHaveClass('md-hr');
});
it('renders a blockquote as blockquote.md-quote holding a board paragraph',()=>{
  render(<SkillMarkdown markdown={'> q'}/>);
  expect(document.querySelector('blockquote.md-quote > p.md-p')?.textContent).toBe('q');
});
it('wraps a GFM table and keeps its column alignment',()=>{
  render(<SkillMarkdown markdown={'| A | B |\n| --- | ---: |\n| a | 1 |'}/>);
  expect(document.querySelector('div.md-table-wrap > table.md-table')).not.toBeNull();
  expect(document.querySelectorAll('th')).toHaveLength(2);
  expect(document.querySelectorAll('th')[1]!.style.textAlign).toBe('right');
  expect(document.querySelectorAll('td')[1]!.style.textAlign).toBe('right');
});
it('renders a labelled link as inert text with the destination beside it',()=>{
  render(<SkillMarkdown markdown={'[docs](https://x.dev/a)'}/>);
  expect(document.querySelectorAll('a')).toHaveLength(0);
  expect(document.querySelector('.md-link')?.textContent).toContain('docs');
  expect(document.querySelector('.md-url')?.textContent).toBe('https://x.dev/a');
});
it('renders a bare autolink once, without a duplicated label',()=>{
  render(<SkillMarkdown markdown={'<https://x.dev>'}/>);
  expect(document.querySelectorAll('a')).toHaveLength(0);
  expect(document.querySelectorAll('.md-url')).toHaveLength(1);
  expect(document.querySelector('.md-url')?.textContent).toBe('https://x.dev');
  expect(document.querySelector('.md-link')).toBeNull();
});
it('renders an image as an inert chip with no img element and no preload link',()=>{
  render(<SkillMarkdown markdown={'![alt text](https://evil.example/p.png)'}/>);
  expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.querySelectorAll('link[rel=preload]')).toHaveLength(0);
  expect(document.querySelector('.md-img')?.textContent).toContain('image · alt text');
  expect(document.querySelector('.md-img')?.textContent).toContain('https://evil.example/p.png');
  expect(document.querySelector('.md-img')).not.toHaveAttribute('title');
});
it('renders an image with no alt text as a bare chip',()=>{
  render(<SkillMarkdown markdown={'![](https://evil.example/q.png)'}/>);
  expect(document.querySelector('.md-img')?.textContent?.startsWith('image')).toBe(true);
  expect(document.querySelector('.md-img')?.textContent).not.toContain('·');
});
it('shows raw HTML placeholders literally',()=>{
  render(<SkillMarkdown markdown={'A <slug> and a <repo>.'}/>);
  expect(document.querySelector('.md-doc')!.textContent).toContain('<slug>');
  expect(document.querySelector('.md-doc')!.textContent).toContain('<repo>');
  expect(document.querySelector('slug')).toBeNull();
  expect([...document.querySelectorAll('*')].some(element=>element.tagName==='SLUG')).toBe(false);
});
it('drops a javascript: destination and leaves the label as plain text',()=>{
  render(<SkillMarkdown markdown={'[x](javascript:alert(1))'}/>);
  expect(document.querySelectorAll('a')).toHaveLength(0);
  expect(document.querySelectorAll('.md-link')).toHaveLength(0);
  expect(document.querySelectorAll('.md-url')).toHaveLength(0);
  expect(document.querySelector('.md-doc')?.textContent).toBe('x');
});
it('drops a data: image source, keeping an empty destination',()=>{
  render(<SkillMarkdown markdown={'![d](data:image/png;base64,AAA)'}/>);
  expect(document.querySelectorAll('img')).toHaveLength(0);
  expect(document.querySelector('.md-img')).not.toBeNull();
  expect(document.querySelector('.md-img .md-url')?.textContent).toBe('');
});
it('renders an in-document anchor as plain text with no destination chip',()=>{
  render(<SkillMarkdown markdown={'[see](#section)'}/>);
  expect(document.querySelectorAll('a')).toHaveLength(0);
  expect(document.querySelectorAll('.md-url')).toHaveLength(0);
  expect(document.querySelector('.md-doc')?.textContent).toBe('see');
});
it('keeps remark-gfm footnote plumbing hidden and renders the note',()=>{
  render(<SkillMarkdown markdown={'Text[^1].\n\n[^1]: note text'}/>);
  expect(document.querySelector('section.footnotes h2')).toHaveClass('md-h2','sr-only');
  const ref=document.querySelector('sup');
  expect(ref?.textContent).toBe('1');
  expect(ref?.querySelectorAll('a, .md-url')).toHaveLength(0);
  expect(document.querySelector('section.footnotes')?.textContent).toContain('note text');
});
it('renders only the wrapper for an empty or whitespace-only document',()=>{
  const {rerender}=render(<SkillMarkdown markdown={''}/>);
  expect(document.querySelector('.md-doc')).not.toBeNull();
  expect(document.querySelector('.md-doc')?.children).toHaveLength(0);
  rerender(<SkillMarkdown markdown={'   \n\n  \n'}/>);
  expect(document.querySelector('.md-doc')).not.toBeNull();
  expect(document.querySelector('.md-doc')?.children).toHaveLength(0);
});
it('renders an unterminated fence as a code block rather than throwing',()=>{
  expect(()=>render(<SkillMarkdown markdown={'Text\n\n```bash\nnever closed\n'}/>)).not.toThrow();
  expect(document.querySelector('pre.md-code > code.language-bash')?.textContent).toBe('never closed\n');
});
it('leaves a Windows UNC path in prose as CommonMark renders it',()=>{
  const md = String.raw`A root at \\wsl.localhost\Ubuntu\home and a ` + '`' + String.raw`\\server\share` + '`' + ` path.`;
  render(<SkillMarkdown markdown={md}/>);
  expect(document.querySelector('p')?.textContent).toContain(String.raw`\wsl.localhost\Ubuntu\home`);
  expect(document.querySelector('code')?.textContent).toBe(String.raw`\\server\share`);
});
it('reuses one components map across renders',()=>{
  const {rerender}=render(<SkillMarkdown markdown={'## Steps'}/>);
  const first=document.querySelector('.md-h2');
  expect(first).not.toBeNull();
  rerender(<SkillMarkdown markdown={'## Steps'}/>);
  expect(document.querySelector('.md-h2')).toBe(first);
});
it('renders a very long unbroken destination without an anchor',()=>{
  render(<SkillMarkdown markdown={'[x](https://example.com/'+'a'.repeat(180)+')'}/>);
  expect(document.querySelectorAll('a')).toHaveLength(0);
  expect(document.querySelector('.md-url')?.textContent).toContain('a'.repeat(180));
});
