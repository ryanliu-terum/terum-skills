import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { BOARDS } from '../boards';
import { readFidelity } from '../fidelity-md';
import { TOLERANCE, PIXELMATCH_OPTIONS } from '../tolerance';
import { oraclePath, resolveDesignDir } from '../design-dir';
const design = resolveDesignDir();
describe('board manifest',()=>{
 it('matches all 87 fidelity rows in both directions',()=>{expect(BOARDS).toHaveLength(87);expect(new Set(BOARDS.map(b=>b.name)).size).toBe(87);expect([...readFidelity().keys()].sort()).toEqual(BOARDS.map(b=>b.name).sort());});
 it('has hash routes and immutable class tolerances',()=>{expect(BOARDS.every(b=>b.route.startsWith('#/'))).toBe(true);expect(TOLERANCE).toEqual({screen:.0030,dialog:.0035,state:.0020,full:.0025});expect(PIXELMATCH_OPTIONS).toEqual({threshold:0.1,includeAA:true});for(const name of ['Main','Light'])expect(BOARDS.find(board=>board.name===name)?.exact).toBe(true);});
});
describe.skipIf(design === undefined)('read-only oracles (TERUM_DESIGN_DIR)',()=>{
 it.each(BOARDS)('$name has a read-only oracle matching its viewport',board=>{if(!design)throw new Error('unreachable: oracle test ran without TERUM_DESIGN_DIR');const path=oraclePath(design.shots,board.name);expect(existsSync(path),path).toBe(true);const bytes=readFileSync(path);expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]).toEqual([board.width,board.height]);});
});
