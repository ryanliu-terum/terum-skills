import type { SkillCard } from '../../backend/types';
export function ScanCoverage({scanned,skills}:{scanned:string[]|null;skills:SkillCard[]}) {
 if(scanned===null)return null;
 return <div className="board-small">Scanned: {scanned.join(', ')}{skills.some(skill=>skill.onDiskOnly)?<span> · {skills.filter(skill=>skill.installed==='placed').length} on this machine · {skills.filter(skill=>skill.placed).length} placed</span>:null}</div>;
}
