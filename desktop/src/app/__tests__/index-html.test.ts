import { readFileSync } from 'node:fs';
import { assert, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');

it('declares exactly one inline SVG favicon', () => {
 expect(html.match(/<link rel="icon" href="data:image\/svg\+xml,/g)).toHaveLength(1);
 const document = new DOMParser().parseFromString(html, 'text/html');
 const icons = document.querySelectorAll('link[rel="icon"]');
 expect(icons).toHaveLength(1);
 const href = icons[0]?.getAttribute('href');
 assert(typeof href === 'string', 'The favicon must have an href');
 const svg = new DOMParser().parseFromString(decodeURIComponent(href.slice('data:image/svg+xml,'.length)), 'image/svg+xml');
 expect(svg.querySelector('parsererror')).toBeNull();
 expect(svg.documentElement.getAttribute('viewBox')).toBe('2190 1925 200 200');
 expect(svg.querySelectorAll('path')).toHaveLength(3);
 expect(svg.querySelectorAll('circle')).toHaveLength(1);
 expect(svg.querySelectorAll('[fill="#f7f8f8"]')).toHaveLength(3);
 expect(svg.querySelectorAll('[stroke="#f7f8f8"]')).toHaveLength(2);
});

it('preserves the verbatim theme boot script before the app root', () => {
 const bootScript = "<script>try{var t=localStorage.getItem('terum-theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}</script>";
 expect(html.split('\n')).toContain(bootScript);
 expect(html.indexOf(bootScript)).toBeLessThan(html.indexOf('<div id="root">'));
});
