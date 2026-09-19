import { TERUM_MARK_HTML } from './terum-mark';
export function TerumMark({size=22,color='var(--tk-text1)'}:{size?:number;color?:string}) {
 // Trusted paths transcribed from the design's TERUM_MARK, never user input.
 return <svg width={size} height={size} viewBox="2190 1925 200 200" role="img" aria-label="Terum" style={{color,flexShrink:0,display:'block'}} dangerouslySetInnerHTML={{__html: TERUM_MARK_HTML}} />;
}
