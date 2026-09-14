import { useLocation,useSearchParams,useNavigate } from 'react-router';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useEffect,useRef,useState } from 'react';
import type { FileDropEvent, LibraryScope, Root, SkillCard as Card } from '../../backend/types';
import { plural } from '../marketplace/market-data';
import type { ReactNode } from 'react';
import { useBackend,useFeatures } from '../../backend';
import { useUiStore } from '../../app/store';
import { useUrlState } from '../../app/url-state';
import { Shell } from '../../components/domain/Shell';
import { ScreenFrame } from '../../components/domain/ScreenFrame';
import { Analytics,AnalyticsDivider,AnalyticsSkeleton } from '../../components/domain/Analytics';
import { SkillCard,SkillCardSkeleton } from '../../components/domain/SkillCard';
import { CenteredState,ErrorLine,SearchRow,TerminalHint,ViewHeader } from '../../components/domain/Primitives';
import { useWorkflow } from '../../components/domain/useWorkflow';
import { Button } from '../../components/ui/Button';
import { LibrarySelectionBar } from './LibrarySelectionBar';
import { BulkPublishDialog } from './BulkPublishDialog';
import type { BulkPublishSummary } from './bulk-publish';
import { bulkEvalHandoff, bulkEvalSearch, leftOutText } from './bulk-eval-handoff';
import { LibraryFilters } from './LibraryFilters';
import { activeLibraryFacetCount,libraryFacetMatches,libraryQueryMatches,parseLibraryFacets,stripLibraryFacets } from './library-facets';
import { parseSort,sortCards,SORT_OPTIONS } from './library-sort';
import './library.css';
/** The header's "which folder is this, and does it have a GitHub home" line (Ryan, 2026-09-09). Global is a folder with no repository. */
function rootMeta(root:Root|undefined):ReactNode{
 if(root===undefined)return undefined;
 if(root.kind==='global')return <span>{root.root}</span>;
 const remote=root.remote??null;
 const connected=remote!==null&&remote.slug!==null;
 return <><span>{root.root}</span><span aria-hidden="true">·</span><span {...(remote!==null&&remote.slug===null?{title:'origin is '+remote.url}:{})}>{connected?'GitHub: '+remote.slug:'GitHub: not connected'}</span></>;
}
const EMPTY_KEYS:ReadonlySet<string>=new Set();
const cardKey=(card:Card):string=>card.path??card.name;
// The Library reads the global skills folder and only the projects the user explicitly added.
export function LibraryScreen(){const location=useLocation(),state=useUrlState(),backend=useBackend(),features=useFeatures(),action=useWorkflow(),navigate=useNavigate(),[search,setSearch]=useSearchParams(),[actionError,setActionError]=useState<string|null>(null),queryClient=useQueryClient();const root=search.get('root')??'',scope:LibraryScope=location.pathname==='/library/checkout'?{kind:'checkout',root}:{kind:'global'},missing=scope.kind==='checkout'&&!root,scopeKey=scope.kind==='global'?'global':scope.root;
 // Selection mode (batch E, 2026-09-13) is a URL state (`?select=1`) so it is a link; the selected SET is
 // component state keyed by the scope — never in the URL, a link should not carry a half-made selection —
 // dropped by Done, Escape and a scope change, and kept across a query or facet change so the bar can count
 // it against the current draw. Keying by scope instead of resetting in an effect keeps the hooks rules happy.
 const selecting=search.get('select')==='1';const [selection,setSelection]=useState<{scopeKey:string;keys:ReadonlySet<string>}>({scopeKey,keys:EMPTY_KEYS}),[notice,setNotice]=useState<string|null>(null);const selectedKeys=selecting&&selection.scopeKey===scopeKey?selection.keys:EMPTY_KEYS;
 const query=useQuery({queryKey:['library',scope.kind==='global'?'global':scope.root,state.mock],enabled:!missing,queryFn:({signal})=>backend.library({scope},{signal})});const data=query.data?.ok?query.data.value:undefined,title=data?.root.label??(scope.kind==='global'?'Global':root.split(/[\\/]/).filter(Boolean).at(-1)??''),selected=scope.kind==='global'?'Global':data?.root.id??root,error=query.data?.ok===false?query.data.error:query.isError?query.error.message:null,loading=query.isPending&&!error&&!missing,empty=data?.skills.length===0;
 // The committed selection and the order both live in the URL, so a Library view is a link. `sort` is
 // absent for the default order, and the badge counts the facet groups that are ACTUALLY applied rather
 // than echoing the URL's `active` string: serializeLibraryFacets writes the two in lockstep, so they
 // agree on every link the app produces, and a hand-typed `?active=7` can never make the button claim
 // seven filters over an unfiltered grid (Teddy's data-honesty rule).
 const sort=parseSort(search),facets=parseLibraryFacets(search),activeCount=facets?activeLibraryFacetCount(facets):0;
 const filtered=sortCards((data?.skills??[]).filter(s=>libraryQueryMatches(s,state.q??'')).filter(s=>facets===null||libraryFacetMatches(s,facets)),sort);
 // `N of M` and the publish set are the selected cards among those DRAWN: a card hidden by the query or a facet
 // stays selected but is neither counted nor sent, so the button never promises more than the grid shows.
 const drawnSelected=filtered.filter(card=>selectedKeys.has(cardKey(card)));
 // "Evaluate N…" counts only the drawn selection the ⋯ menu could evaluate; the rest is named under the bar. The
 // question itself is the app-wide bulk-eval dialog, reached by URL like every other dialog here (a push, so Back closes it).
 const evalHandoff=bulkEvalHandoff(drawnSelected),leftOut=leftOutText(evalHandoff.leftOut);
 function openBulkEval(){setSearch(bulkEvalSearch(search,evalHandoff.refs));}
 function setKeys(keys:ReadonlySet<string>){setSelection({scopeKey,keys});}
 function toggleCard(key:string){const next=new Set(selectedKeys);if(next.has(key))next.delete(key);else next.add(key);setKeys(next);}
 // `replace` is for the search field: `q` used to PUSH a history entry per keystroke, so Back walked
 // back through every character. TYPING always replaces — including the backspace that empties the field,
 // which used to push and left Back returning to a one-character query the user never meant to visit
 // (review 2026-09-13). Everything else here (filters, sort, and the ✕ that clears the query in one
 // gesture) is a navigation the user should be able to undo with Back, so it still pushes.
 function param(key:string,value:string|null,replace=false){const next=new URLSearchParams(search);if(value)next.set(key,value);else next.delete(key);setSearch(next,{replace});}
 function toggleSelecting(){if(selecting){setKeys(EMPTY_KEYS);const next=new URLSearchParams(search);next.delete('select');next.delete('dialog');setSearch(next);}else param('select','1');}
 /** Done in the bulk dialog: the clone changed, so every Library read and skill page refetches; the selection and the mode end; the Library's one status line reports the count. The URL write REPLACES so Back does not reopen the dialog. */
 function finishBulk(summary:BulkPublishSummary){void queryClient.invalidateQueries({queryKey:['library']});void queryClient.invalidateQueries({queryKey:['skill']});setKeys(EMPTY_KEYS);setNotice(`Published ${summary.published} of ${plural(summary.attempted,'skill')}`+(summary.failed>0?` · ${summary.failed} failed`:''));const next=new URLSearchParams(search);next.delete('dialog');next.delete('select');setSearch(next,{replace:true});}
 // Escape leaves selection mode, but yields to the filter popover (it has its own Escape and stops propagation),
 // to any open dialog, and to a field the user is typing in. No dependency list: the listener closes over this
 // render's state and is cheap to re-attach.
 useEffect(()=>{
  if(!selecting||state.filters==='open'||state.dialog)return undefined;
  const onKey=(event:KeyboardEvent)=>{if(event.key!=='Escape'||event.defaultPrevented)return;const target=event.target;if(target instanceof HTMLElement&&(target.matches('input,textarea,select')||target.isContentEditable))return;event.preventDefault();toggleSelecting();};
  document.addEventListener('keydown',onKey);return ()=>document.removeEventListener('keydown',onKey);
 });
 /** Drops the whole committed selection — facets, the count and the open popover — in one write. */
 function clearFilters(){const next=stripLibraryFacets(search);next.delete('active');next.delete('filters');setSearch(next);}
 // The empty-state primary is the sidebar's Add project flow (native chooser + `project add`, PR #102);
 // it needs the CLI's libraryProjects feature, so an older CLI degrades to the marketplace link.
 const canAddProject=features?.libraryProjects===true;
 // A folder dragged from the OS onto the window adds a project the way the chooser does (2026-09-14). The overlay
 // draws only while a drag hovers, so no board moves; the handler lives in a ref so the subscription is made once.
 const [dropping,setDropping]=useState(false),onDrop=useRef<(paths:string[])=>void>(()=>{});
 useEffect(()=>{
  if(!canAddProject)return undefined;
  return backend.onFileDrop((event:FileDropEvent)=>{if(event.kind==='enter')setDropping(true);else if(event.kind==='leave')setDropping(false);else{setDropping(false);onDrop.current(event.paths);}});
 },[backend,canAddProject]);
 /** One `project add` per dropped folder, in order; the Library's status line counts what landed and the error line names the first refusal. */
 async function addDropped(paths:string[]){
  if(action.busy)return;
  setActionError(null);
  if(paths.length===0){setActionError('Nothing to add: the drop carried no folder path.');return;}
  let added=0;const failures:string[]=[];
  for(const path of paths){const result=await action.run(()=>backend.projects.add(path));if(result?.ok)added+=1;else failures.push(result?result.error:'Cancelled.');}
  setNotice(`Added ${plural(added,'project')}`+(failures.length?` · ${failures.length} failed`:''));
  if(failures[0]!==undefined)setActionError(failures[0]);
 }
 useEffect(()=>{onDrop.current=paths=>{void addDropped(paths);};});
 async function addProject(){
  if(action.busy)return;
  const picked=await backend.pickFolder();
  if(!picked.ok){action.fail(picked.error);return;}
  if(picked.value===null)return;
  const path=picked.value;
  await action.run(()=>backend.projects.add(path));
 }
 return <Shell counts={loading||error?null:undefined} selected={selected}><ScreenFrame ready={missing||!query.isPending||state.mock==='loading'}><ViewHeader title={title} {...(data&&!error?{subtitle:data.title,meta:rootMeta(data.root)}:{})} {...(!error?{overview:state.overviewHidden?'show' as const:'hide' as const,onOverview:()=>{useUiStore.getState().setOverviewHidden(!state.overviewHidden);param('overview',state.overviewHidden?null:'0');}}:{})}/>{actionError?<ErrorLine>{actionError}</ErrorLine>:null}{dropping?<div className="library-drop" role="status">Drop a folder to add it as a project</div>:null}{notice?<div role="status" className="library-notice">{notice}</div>:null}{missing?<CenteredState alert icon="alert" title="Couldn't read your library" body="Select a checkout from your Library."><ErrorLine>No checkout selected.</ErrorLine></CenteredState>:error?<CenteredState alert icon="alert" title="Couldn't read your library" body="terum-skills could not read ~/.terum/skills. Check the folder still exists and is readable, then try again." primary="Try again" secondary="Show in Finder" onPrimary={()=>{setActionError(null);void query.refetch();}} onSecondary={()=>void backend.revealPath('~/.terum/skills').then(result=>{if(!result.ok)setActionError(result.error);},e=>setActionError(e instanceof Error?e.message:'Could not open folder.'))}><ErrorLine>{error}</ErrorLine></CenteredState>:<>{!state.overviewHidden?<>{loading?<AnalyticsSkeleton/>:data?<Analytics overview={data.overview} zero={empty} provenance=""/>:null}<AnalyticsDivider/></>:null}<SearchRow query={state.q??''} placeholder={loading||empty?'Search skills':'Search '+plural(data?.skills.length??0,'skill')} onChange={q=>param('q',q||null,true)} onClear={()=>param('q',null)} filter={activeCount?'Filter · '+activeCount:'Filter'} sortOptions={SORT_OPTIONS} sortValue={sort} onSort={value=>param('sort',value==='updated'?null:value)} filterOpen={state.filters==='open'} onFilter={()=>param('filters',state.filters==='open'?null:'open')} trailing={data&&!empty?<Button kind="ghost" icon="check-circle" className="search-select-trigger" aria-pressed={selecting} onClick={toggleSelecting}>{selecting?'Done':'Select'}</Button>:undefined}>{state.filters==='open'&&data?<LibraryFilters cards={data.skills} query={state.q??''} onClose={()=>param('filters',null)}/>:null}</SearchRow>{selecting&&data&&!empty?<><LibrarySelectionBar selected={drawnSelected.length} drawn={filtered.length} onSelectAll={()=>setKeys(new Set([...selectedKeys,...filtered.map(cardKey)]))} onClear={()=>setKeys(EMPTY_KEYS)} onPublish={()=>param('dialog','publish')}>{features?.runEvalInApp?<Button disabled={evalHandoff.refs.length===0} state={state.dialog==='bulk-eval'?'pressed':'default'} onClick={openBulkEval}>{evalHandoff.refs.length===0?'Evaluate…':`Evaluate ${plural(evalHandoff.refs.length,'skill')}…`}</Button>:null}</LibrarySelectionBar>{leftOut!==null?<div role="note" className="library-selection-note">{leftOut}</div>:null}</>:null}{loading?<div className="library-grid" aria-label="Loading skills">{Array.from({length:9},(_,i)=><SkillCardSkeleton key={i}/>)}</div>:empty?<CenteredState icon="box" title={scope.kind==='global'?'No skills in your global library':`No skills in ${title}`}  body="Skills in ~/.claude/skills and in the projects you add show up here." primary={canAddProject?'Add project':'Open marketplace'} {...(canAddProject?{secondary:'Open marketplace',onSecondary:()=>navigate('/marketplace')}:{})} onPrimary={canAddProject?()=>void addProject():()=>navigate('/marketplace')}><TerminalHint command="npx -y terum-skills@latest install &lt;ref&gt;" prefix="From the terminal"/>{action.error&&<ErrorLine>{action.error}</ErrorLine>}</CenteredState>:!filtered.length?<CenteredState icon="search" title={(state.q?`No skills match “${state.q}”`:'No skills match')+(activeCount?` with ${plural(activeCount,'filter')} on`:'')} body={activeCount?'Try a shorter query, or clear the filters to search the whole library.':"Try a shorter query, or search your team's marketplace for it."} primary={activeCount?'Clear filters':'Clear search'} secondary="Search marketplace" onPrimary={activeCount?()=>clearFilters():()=>param('q',null)} onSecondary={()=>navigate('/marketplace?q='+encodeURIComponent(state.q??''))}/>:<div className="library-grid">{filtered.map(skill=><SkillCard key={cardKey(skill)} skill={skill} selectable={selecting} selected={selectedKeys.has(cardKey(skill))} onToggle={()=>toggleCard(cardKey(skill))}/>)}</div>}{selecting&&state.dialog==='publish'?<BulkPublishDialog cards={drawnSelected} onClose={()=>param('dialog',null,true)} onFinished={finishBulk}/>:null}</>}</ScreenFrame></Shell>;
}
