import { useUrlState } from '../../app/url-state';
import { useShellReady } from './Shell';
import { Component, useLayoutEffect } from 'react';
import type { PropsWithChildren } from 'react';
export class ErrorBoundary extends Component<PropsWithChildren,{message:string|null}> {
 state:{message:string|null}={message:null};
 static getDerivedStateFromError(error:unknown){return {message:error instanceof Error?error.message:String(error)};}
 render(){return this.state.message!==null?<div data-error-boundary role="alert">{this.state.message}</div>:this.props.children;}
}
export function ScreenFrame({children,ready=true}:PropsWithChildren<{ready?:boolean}>){
 const {theme}=useUrlState();const shellReady=useShellReady();
 useLayoutEffect(()=>{
  const root=document.documentElement;
  function updateReady(){
   const expected=theme==='system'?(typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):theme;
   const themeReady=expected!=='dark'&&expected!=='light'||root.dataset.theme===expected;
   if(ready&&shellReady&&themeReady)root.dataset.appReady='true';else delete root.dataset.appReady;
  }
  const observer=new MutationObserver(updateReady);
  observer.observe(root,{attributes:true,attributeFilter:['data-theme']});
  updateReady();
  return()=>{observer.disconnect();delete root.dataset.appReady;};
 },[theme,shellReady,ready]);
 return <ErrorBoundary>{children}</ErrorBoundary>;
}
