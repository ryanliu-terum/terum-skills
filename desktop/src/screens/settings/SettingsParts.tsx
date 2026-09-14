import type { PropsWithChildren, ReactNode } from 'react';
import { RichText, SectionLabel } from '../../components/domain/Primitives';
import { Icon } from '../../components/ui/Icon';
import { CopyValue } from '../../components/domain/ContextMenu';
import { useContextMenu } from '../../components/domain/context-menu';
import type { ContextMenuBuilder } from '../../components/domain/context-menu';
export function SettingsHead({title,sub}:{title:string;sub:string}){return <div className="settings-head"><h1>{title}</h1><span><RichText text={sub}/></span></div>;}
/** `menu` gives the row a right-click menu (Show in Finder, Copy path, …); the row's pixels do not change. */
export function SettingRow({title,desc='',children,menu=null,onClick}:{title:string;desc?:ReactNode;children?:ReactNode;menu?:ContextMenuBuilder|null;onClick?:()=>void}){const ref=useContextMenu(menu);return <div className="setting-row" ref={ref} onClick={onClick}><div><span>{title}</span>{desc&&<span>{typeof desc==='string'?<RichText text={desc}/>:desc}</span>}</div><div>{children}</div></div>;}
export function SettingCard({children}:PropsWithChildren){return <div className="setting-card">{children}</div>;}
export function SettingsGroup({label,children,note,trailing}:{label:string;children:ReactNode;note?:ReactNode;trailing?:ReactNode}){return <section className="settings-group"><SectionLabel trailing={trailing}>{label}</SectionLabel>{children}{note}</section>;}
export function SettingsNote({children}:PropsWithChildren){return <span className="settings-note">{children}</span>;}
export function Mono({children}:PropsWithChildren){return <span className="board-mono">{children}</span>;}
/** A mono value (a path, a handle, a hash, a flag) copies itself on click; `copy` names what was copied and can override the text. `copy={null}` opts out. */
export function Value({children,mono=false,quiet=false,copy}:PropsWithChildren<{mono?:boolean;quiet?:boolean;copy?:{what:string;text?:string}|null}>){
 const className='settings-value'+(mono?' board-mono':''),style={color:quiet?'var(--tk-text2)':'var(--tk-text1)',fontSize:mono?12:13};
 const copying=copy===null?null:copy??(mono?{what:'value'}:null);
 return copying?<CopyValue what={copying.what} {...(copying.text!==undefined?{text:copying.text}:{})} className={className} style={style}>{children}</CopyValue>:<span className={className} style={style}>{children}</span>;
}
export function LockedValue({children}:PropsWithChildren){return <span className="settings-status"><Icon name="lock" size={14} stroke="1.75" color="var(--tk-text3)"/><Value mono copy={{what:'handle'}}>{children}</Value></span>;}
export function StatusValue({children,kind='ok'}:PropsWithChildren<{kind?:'ok'|'warn'|'bad'|'unknown'}>){return <span className="settings-status"><Icon name={kind==='ok'?'check-circle':'alert'} size={14} stroke="1.75" color={`var(--tk-${kind==='ok'?'good':kind==='unknown'?'text3':kind})`}/><Value>{children}</Value></span>;}
