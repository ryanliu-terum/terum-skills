import type { PropsWithChildren, ReactNode } from 'react';
import { RichText, SectionLabel } from '../../components/domain/Primitives';
import { Icon } from '../../components/ui/Icon';
export function SettingsHead({title,sub}:{title:string;sub:string}){return <div className="settings-head"><h1>{title}</h1><span><RichText text={sub}/></span></div>;}
export function SettingRow({title,desc='',children}:{title:string;desc?:ReactNode;children?:ReactNode}){return <div className="setting-row"><div><span>{title}</span>{desc&&<span>{typeof desc==='string'?<RichText text={desc}/>:desc}</span>}</div><div>{children}</div></div>;}
export function SettingCard({children}:PropsWithChildren){return <div className="setting-card">{children}</div>;}
export function SettingsGroup({label,children,note,trailing}:{label:string;children:ReactNode;note?:ReactNode;trailing?:ReactNode}){return <section className="settings-group"><SectionLabel trailing={trailing}>{label}</SectionLabel>{children}{note}</section>;}
export function SettingsNote({children}:PropsWithChildren){return <span className="settings-note">{children}</span>;}
export function Mono({children}:PropsWithChildren){return <span className="board-mono">{children}</span>;}
export function Value({children,mono=false,quiet=false}:PropsWithChildren<{mono?:boolean;quiet?:boolean}>){return <span className={'settings-value'+(mono?' board-mono':'')} style={{color:quiet?'var(--tk-text2)':'var(--tk-text1)',fontSize:mono?12:13}}>{children}</span>;}
export function LockedValue({children}:PropsWithChildren){return <span className="settings-status"><Icon name="lock" size={14} stroke="1.75" color="var(--tk-text3)"/><Value mono>{children}</Value></span>;}
export function StatusValue({children,kind='ok'}:PropsWithChildren<{kind?:'ok'|'warn'|'bad'}>){return <span className="settings-status"><Icon name={kind==='ok'?'check-circle':'alert'} size={14} stroke="1.75" color={`var(--tk-${kind==='ok'?'good':kind})`}/><Value>{children}</Value></span>;}
