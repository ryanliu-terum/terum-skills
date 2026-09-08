import { afterEach,expect,it } from 'vitest';
import { cleanup,render } from '@testing-library/react';
import { decodeText } from './fixture-text';
import { RichText } from '../components/domain/Primitives';
afterEach(cleanup);
it('decodes named, decimal and hexadecimal entities without parsing markup',()=>expect(decodeText('&lt;skill&gt; &#39; &amp; &#x1f600;')).toBe("<skill> ' & 😀"));
it('renders only literal b tags as styled text and leaves other markup inert',()=>{const {container}=render(<RichText text={'<b>ajay</b> installed &lt;skill&gt; <img src=x onerror=alert(1)> &lt;b&gt;literal&lt;/b&gt;'}/>);expect(container.querySelectorAll('span')).toHaveLength(1);expect(container.querySelector('img')).toBeNull();expect(container.textContent).toBe('ajay installed <skill> <img src=x onerror=alert(1)> <b>literal</b>');});
it('replaces invalid unicode numeric entities safely',()=>expect(decodeText('&#x110000; &#xD800;')).toBe('� �'));
