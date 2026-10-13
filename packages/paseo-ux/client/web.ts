import {Platform} from 'react-native';
import type {PluginTheme} from '@getpaseo/plugin';
import {previewWindow} from '../shared/media';
import {zoomAt,dragViewport,fittedViewport,type ImageViewport} from '../shared/viewport';

// This adapter intentionally owns all desktop/web DOM knowledge. Native clients use the media panel.
type DomNode = {
  nodeType:number;textContent:string|null;parentElement:DomElement|null;childNodes:ArrayLike<DomNode>;
  contains(node:DomNode):boolean;
};
type DomElement = DomNode & {
  cloneNode(deep:boolean):DomElement;tagName:string;isConnected:boolean;children:ArrayLike<DomElement>;style:{setProperty(name:string,value:string):void;removeProperty(name:string):void};
  getAttribute(name:string):string|null;setAttribute(name:string,value:string):void;removeAttribute(name:string):void;
  querySelector(selector:string):DomElement|null;querySelectorAll(selector:string):ArrayLike<DomElement>;closest(selector:string):DomElement|null;
  appendChild(child:DomElement):void;insertBefore(child:DomElement,before:DomNode|null):void;remove():void;click():void;
  addEventListener(name:string,handler:(()=>void)|((event:KeyboardInput)=>void)):void;
  getBoundingClientRect():{width:number;height:number;left:number;top:number};
};
type DomDocument={body:DomElement;head:DomElement;createElement(tag:string):DomElement;createElementNS(namespace:string,tag:string):DomElement;querySelector(selector:string):DomElement|null};
type DomObserver={observe(target:DomElement,options:Record<string,unknown>):void;disconnect():void};
type DomEnvironment={document:DomDocument;MutationObserver:new(callback:()=>void)=>DomObserver;setTimeout(fn:()=>void,delay:number):number;clearTimeout(id:number):void};

export type InlineImage = {source:string;uri:string;label:string};
type Frame={node:DomElement;image:InlineImage;boundary:string};
type Group={frames:Frame[];element:DomElement;signature:string;expanded:boolean};
const controllers=new Set<()=>void>();

function environment():DomEnvironment|null{
  if(Platform.OS!=='web')return null;
  const value=globalThis as unknown as Partial<DomEnvironment>;
  return value.document && value.MutationObserver ? value as DomEnvironment:null;
}

/** Recognize consecutive image frames, sealing a run at text, tools, and message boundaries. */
export function discoverImageRuns(scroll:DomElement):Frame[][]{
  const runs:Frame[][]=[];
  let current:Frame[]=[];
  const seal=()=>{if(current.length)runs.push(current);current=[];};
  const walk=(node:DomNode,boundary:string)=>{
    if(node.nodeType===3){if(node.textContent?.trim())seal();return;}
    if(node.nodeType!==1)return;
    const element=node as DomElement;
    if(element.getAttribute('data-paseo-ux-group')!==null || element.getAttribute('data-paseo-markdown-ignore')==='true')return;
    const tag=element.getAttribute('data-paseo-markdown-tag');
    if(tag==='img'){
      const image=element.querySelector('img');
      const uri=image?.getAttribute('src');
      const source=element.getAttribute('data-paseo-markdown-src');
      // Pending and failed frames retain Paseo's own loading/error UI.
      if(!uri||!source){seal();return;}
      current.push({node:element,image:{source,uri,label:element.getAttribute('data-paseo-markdown-alt')||source.split('/').pop()||'图片'},boundary});return;
    }
    if(['pre','code','hr','table','blockquote','li'].includes(tag??'')){seal();return;}
    for(const child of Array.from(element.childNodes))walk(child,boundary);
  };
  // Traverse in displayed DOM order so images split into adjacent native rows also aggregate.
  // Any intervening user content, tool output, or ordinary text seals the group.
  const visit=(node:DomNode)=>{
    if(node.nodeType===3){if(node.textContent?.trim())seal();return;}
    if(node.nodeType!==1)return;
    const element=node as DomElement;
    if(element.getAttribute('data-paseo-ux-group')!==null)return;
    if(element.getAttribute('data-testid')==='assistant-message'){
      walk(element,element.closest('[data-message-id]')?.getAttribute('data-message-id')??'');return;
    }
    for(const child of Array.from(element.childNodes))visit(child);
  };
  visit(scroll);seal();return runs;
}

export function mountInlineMedia(options:{agentId:string;theme:PluginTheme;limit:number;enabled:boolean;onPreview:(images:InlineImage[],index:number)=>void;onPanel:()=>void}):()=>void{
  const env=environment();if(!env||!options.enabled)return ()=>{};
  const groups=new Map<DomElement,Group>();
  const expanded=new Map<string,boolean>();
  let stopped=false;let timer:number|undefined;let observer:DomObserver;
  const owned=`${options.agentId}-${Math.random().toString(36).slice(2,8)}`;
  const style=env.document.createElement('style');
  style.textContent=`[data-paseo-ux-hidden="${owned}"]{display:none!important}[data-paseo-ux-group="${owned}"]{color:${options.theme.colors.foreground};background:${options.theme.colors.surface1};border:1px solid ${options.theme.colors.border};border-radius:12px;padding:12px;margin:4px 0 12px;max-width:100%;box-sizing:border-box;font-family:inherit}[data-paseo-ux-group="${owned}"] button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}[data-paseo-ux-group="${owned}"] button:focus-visible{outline:2px solid ${options.theme.colors.accent};outline-offset:3px}[data-paseo-ux-group="${owned}"] .pux-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}[data-paseo-ux-group="${owned}"] .pux-thumb{display:flex;align-items:center;justify-content:center;width:112px;height:84px;padding:0;overflow:hidden;border-radius:8px;background:${options.theme.colors.surface2};position:relative}[data-paseo-ux-group="${owned}"] img{display:block;width:100%;height:100%;object-fit:contain}[data-paseo-ux-group="${owned}"] .pux-header{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px}[data-paseo-ux-group="${owned}"] .pux-muted{color:${options.theme.colors.foregroundMuted}}`;
  env.document.head.appendChild(style);

  const button=(label:string,onPress:()=>void)=>{const node=env.document.createElement('button');node.setAttribute('type','button');node.setAttribute('aria-label',label);node.textContent=label;node.addEventListener('click',onPress);return node;};
  const unhide=(group:Group)=>{group.element.remove();for(const frame of group.frames){if(frame.node.getAttribute('data-paseo-ux-hidden')===owned)frame.node.removeAttribute('data-paseo-ux-hidden');}};
  const signature=(frames:Frame[])=>frames.map(f=>`${f.boundary}:${f.image.source}:${f.image.uri}`).join('\n');
  const render=(group:Group)=>{
    while(group.element.children.length)group.element.children[0]!.remove();
    const images=group.frames.map(f=>f.image);
    const window=previewWindow(images,options.limit,group.expanded);
    const header=env.document.createElement('div');header.setAttribute('class','pux-header');
    const title=env.document.createElement('span');title.textContent=`图片 · ${window.total} 张`;header.appendChild(title);
    const actions=env.document.createElement('div');
    actions.appendChild(button('媒体面板',options.onPanel));
    if(images.length>options.limit){const toggle=button(group.expanded?'收起':`展开其余 ${window.hidden} 张`,()=>{group.expanded=!group.expanded;expanded.set(group.frames[0]!.image.source,group.expanded);render(group);});toggle.setAttribute('aria-expanded',String(group.expanded));actions.appendChild(toggle);}
    header.appendChild(actions);group.element.appendChild(header);
    const thumbs=env.document.createElement('div');thumbs.setAttribute('class','pux-thumbs');
    window.visible.forEach((image,index)=>{
      const thumb=button(`预览第 ${index+1} 张：${image.label}`,()=>options.onPreview(images,index));thumb.setAttribute('class','pux-thumb');
      thumb.textContent='';const img=env.document.createElement('img');img.setAttribute('src',image.uri);img.setAttribute('alt',image.label);img.setAttribute('loading','lazy');thumb.appendChild(img);thumbs.appendChild(thumb);
    });
    if(window.hidden>0){const more=button(`+${window.hidden}`,()=>{group.expanded=true;expanded.set(group.frames[0]!.image.source,true);render(group);});more.setAttribute('class','pux-thumb pux-muted');more.setAttribute('aria-label',`展开其余 ${window.hidden} 张图片`);thumbs.appendChild(more);}
    group.element.appendChild(thumbs);
  };
  const findScroll=()=>{
    const anchor=env.document.querySelector(`[data-testid="paseo-ux-anchor-${options.agentId}"]`);
    for(let node=anchor?.parentElement??null;node;node=node.parentElement){
      const scrolls=Array.from(node.querySelectorAll('[data-testid="agent-chat-scroll"]'));
      if(scrolls.length===1)return scrolls[0]!;
      if(scrolls.length>1)return null;
    }
    return null;
  };
  const scan=()=>{
    if(stopped)return;
    observer.disconnect();
    try{
      const scroll=findScroll();
      if(!scroll){for(const group of groups.values())unhide(group);groups.clear();return;}
      const runs=discoverImageRuns(scroll);
      const alive=new Set<DomElement>();
      for(const frames of runs){
        const first=frames[0]!;alive.add(first.node);const key=signature(frames);let group=groups.get(first.node);
        if(group?.signature===key && group.element.isConnected)continue;
        if(group)unhide(group);
        const element=env.document.createElement('div');element.setAttribute('data-paseo-ux-group',owned);element.setAttribute('data-paseo-markdown-ignore','true');element.setAttribute('role','group');element.setAttribute('aria-label',`${frames.length} 张图片`);
        group={frames,element,signature:key,expanded:expanded.get(first.image.source)??false};
        render(group);first.node.parentElement?.insertBefore(element,first.node);
        for(const frame of frames)frame.node.setAttribute('data-paseo-ux-hidden',owned);
        groups.set(first.node,group);
      }
      for(const [node,group] of groups)if(!alive.has(node)){unhide(group);groups.delete(node);}
    }finally{if(!stopped)observer.observe(env.document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-paseo-markdown-src','data-message-id']});}
  };
  observer=new env.MutationObserver(()=>{if(timer!==undefined)return;timer=env.setTimeout(()=>{timer=undefined;scan();},80);});
  const cleanup=()=>{stopped=true;observer.disconnect();if(timer!==undefined)env.clearTimeout(timer);for(const group of groups.values())unhide(group);groups.clear();expanded.clear();style.remove();controllers.delete(cleanup);};
  controllers.add(cleanup);scan();return cleanup;
}

export function cleanupInlineMedia(){for(const cleanup of [...controllers])cleanup();}

type KeyboardInput={key:string;code:string;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean;repeat:boolean;isComposing?:boolean;target?:{closest?(selector:string):DomElement|null};defaultPrevented?:boolean;preventDefault():void;stopImmediatePropagation():void};
type PointerInput={clientX:number;clientY:number;pointerId:number;button:number;deltaY?:number;target?:{closest?(selector:string):unknown};preventDefault():void};
type InteractiveElement=DomElement & {addEventListener(name:string,handler:(event:PointerInput)=>void,options?:Record<string,unknown>):void;removeEventListener(name:string,handler:(event:PointerInput)=>void):void;setPointerCapture(id:number):void;releasePointerCapture(id:number):void};
type WebEvents={document:DomDocument&{addEventListener(name:string,handler:(event:KeyboardInput)=>void,capture?:boolean):void;removeEventListener(name:string,handler:(event:KeyboardInput)=>void,capture?:boolean):void;dispatchEvent(event:unknown):void};location:{pathname:string};KeyboardEvent:{new(name:string,input:Record<string,unknown>):unknown;prototype:object}};

// Paseo 0.11.2 handles native shortcuts at window capture, before document handlers.
// Mask only the reserved chord while a participating workspace is active. The original
// accessor stays intact for every other key and is restored when the last scope unloads.
const shortcutScopes=new Set<()=>boolean>();
const forwardedKeys=new WeakSet<object>();
let originalKey:PropertyDescriptor|undefined;
let maskedKey:((this:KeyboardInput)=>string)|undefined;
function physicalKey(event:KeyboardInput){return originalKey?.get?.call(event) as string|undefined ?? event.key;}
function reserveRestoreChord(events:WebEvents,active:()=>boolean){
  if(!shortcutScopes.size){
    originalKey=Object.getOwnPropertyDescriptor(events.KeyboardEvent.prototype,'key');
    if(!originalKey?.get||!originalKey.configurable)throw new Error('当前客户端不支持快捷键适配。');
    const descriptor=originalKey;
    maskedKey=function(){const key=descriptor.get!.call(this) as string;return !forwardedKeys.has(this)&&this.metaKey&&this.shiftKey&&!this.ctrlKey&&!this.altKey&&key.toLowerCase()==='t'&&[...shortcutScopes].some(scope=>scope())?'PaseoUXRestore':key;};
    Object.defineProperty(events.KeyboardEvent.prototype,'key',{...originalKey,get:maskedKey});
  }
  shortcutScopes.add(active);
  return ()=>{shortcutScopes.delete(active);if(!shortcutScopes.size){const current=Object.getOwnPropertyDescriptor(events.KeyboardEvent.prototype,'key');if(current?.get===maskedKey&&originalKey)Object.defineProperty(events.KeyboardEvent.prototype,'key',originalKey);originalKey=undefined;maskedKey=undefined;}};
}

function menuLabel(row:DomElement):DomElement|null{
  let label=Array.from(row.children).find(child=>child.textContent?.trim()&&!child.querySelector('svg'))??null;
  while(label?.children.length){const next=Array.from(label.children).find(child=>child.textContent?.trim());if(!next)break;label=next;}
  return label;
}
function recoveryMenuRow(template:DomElement,env:DomEnvironment,theme:PluginTheme,onSelect:()=>void){
  // Clone the native layout and typography, keeping this row's behavior plugin-owned.
  const row=template.cloneNode(true);
  row.removeAttribute('id');row.removeAttribute('disabled');row.removeAttribute('aria-disabled');row.removeAttribute('aria-checked');
  row.setAttribute('data-testid','paseo-ux-session-menu');row.setAttribute('data-menu-item','true');row.setAttribute('data-menu-disabled','false');
  row.setAttribute('role','menuitem');row.setAttribute('tabindex','-1');row.setAttribute('aria-label','恢复工作区会话…');
  for(const child of Array.from(row.querySelectorAll('[id],[data-testid]'))){child.removeAttribute('id');child.removeAttribute('data-testid');}
  const label=menuLabel(row);if(!label)return null;label.textContent='恢复工作区会话…';
  const content=Array.from(row.children).find(child=>child.contains(label));
  const icon=row.querySelector('svg');
  if(!icon||!content)return null;
  // Keep the native leading slot and remove the original action's shortcut slot.
  for(const child of Array.from(row.children))if(child!==content&&!child.contains(icon))child.remove();
  while(icon.children.length)icon.children[0]!.remove();
  for(const d of ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','M3 3v5h5','M12 7v5l4 2']){const path=env.document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);icon.appendChild(path);}
  icon.setAttribute('aria-hidden','true');
  let hovered=false,focused=false;
  const highlight=()=>row.style.setProperty('background-color',hovered||focused?theme.colors.surface2:'transparent');
  row.style.setProperty('cursor','pointer');row.style.setProperty('opacity','1');highlight();
  row.addEventListener('pointerenter',()=>{hovered=true;highlight();});row.addEventListener('pointerleave',()=>{hovered=false;highlight();});
  row.addEventListener('focus',()=>{focused=true;highlight();});row.addEventListener('blur',()=>{focused=false;highlight();});
  row.addEventListener('click',onSelect);
  row.addEventListener('keydown',(event:KeyboardInput)=>{if(!event.defaultPrevented&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopImmediatePropagation();row.click();}});
  return row;
}

export function mountSessionControls(options:{hostId:string;workspaceId:string;theme:PluginTheme;onRestore:()=>void;onHistory:()=>void}):()=>void{
  const env=environment();if(!env)return ()=>{};
  const events=globalThis as unknown as WebEvents;
  const active=()=>{const path=decodeURIComponent(events.location.pathname);return path.split('/').some((part,i,parts)=>part==='h'&&parts[i+1]===options.hostId&&parts[i+2]==='workspace'&&parts[i+3]===options.workspaceId);};
  const releaseChord=reserveRestoreChord(events,active);
  let menuItem:DomElement|null=null;
  const keydown=(event:KeyboardInput)=>{
    if(forwardedKeys.has(event)||!active()||event.repeat)return;const key=physicalKey(event);
    if(event.metaKey&&event.shiftKey&&!event.ctrlKey&&!event.altKey&&key.toLowerCase()==='t'){
      event.preventDefault();event.stopImmediatePropagation();options.onRestore();
    }else if(event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&(event.code==='Backquote'||key==='`')){
      event.preventDefault();event.stopImmediatePropagation();
      const forwarded= new events.KeyboardEvent('keydown',{key:'T',code:'KeyT',metaKey:true,shiftKey:true,bubbles:true,cancelable:true});
      if(forwarded&&typeof forwarded==='object')forwardedKeys.add(forwarded);events.document.dispatchEvent(forwarded);
    }
  };
  events.document.addEventListener('keydown',keydown,true);
  const shortcutLabels=new Map<DomElement,string>();
  const restoreLabels=()=>{for(const [node,original] of shortcutLabels)if(node.textContent==='⌃`')node.textContent=original;shortcutLabels.clear();};
  const scan=()=>{
    if(!active()){menuItem?.remove();menuItem=null;restoreLabels();return;}
    const menu=env.document.querySelector('[data-testid="workspace-new-tab-menu"]');
    for(const node of shortcutLabels.keys())if(!node.isConnected)shortcutLabels.delete(node);
    if(!menu){menuItem=null;return;}
    const terminal=menu.querySelector('[data-testid="workspace-new-tab-menu-terminal"]');
    if(terminal){for(const node of Array.from(terminal.querySelectorAll('*'))){const original=node.textContent??'';if(!node.children.length&&/^(?:⇧⌘|⌘⇧|Cmd\+Shift\+|Shift\+Cmd\+)T$/i.test(original.replace(/\s/g,''))){shortcutLabels.set(node,original);node.textContent='⌃`';}}}
    if(menuItem?.isConnected&&menu.contains(menuItem))return;
    const agent=menu.querySelector('[data-testid="workspace-new-tab-menu-agent"]');
    const template=terminal??agent??menu.querySelector('[data-menu-item="true"]');if(!template)return;
    menuItem=recoveryMenuRow(template,env,options.theme,()=>{events.document.dispatchEvent(new events.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));options.onHistory();});
    if(!menuItem)return;
    const placement=agent??template;const parent=placement.parentElement;if(!parent)return;
    const siblings=Array.from(parent.children);parent.insertBefore(menuItem,siblings[siblings.indexOf(placement)+1]??null);
  };
  const observer=new env.MutationObserver(scan);
  observer.observe(env.document.body,{childList:true,subtree:true});scan();
  return ()=>{events.document.removeEventListener('keydown',keydown,true);observer.disconnect();menuItem?.remove();restoreLabels();releaseChord();};
}

export function mountImageGestures(options:{id:string;read:()=>ImageViewport;update:(state:ImageViewport)=>void}):()=>void{
  const env=environment();if(!env)return ()=>{};
  let target:InteractiveElement|null=null;let drag:{id:number;x:number;y:number}|null=null;let stopped=false;
  const transform=(next:ImageViewport)=>options.update(next);
  const wheel=(event:PointerInput)=>{
    if(!target)return;event.preventDefault();const rect=target.getBoundingClientRect();const state=options.read();
    const factor=Math.exp(-(event.deltaY??0)*0.002);
    const x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;
    transform(zoomAt(state,factor,{x,y}));
  };
  const down=(event:PointerInput)=>{if(event.button!==0||!target||event.target?.closest?.('button,[role=button],input,textarea'))return;event.preventDefault();drag={id:event.pointerId,x:event.clientX,y:event.clientY};target.setPointerCapture(event.pointerId);target.style.setProperty('cursor','grabbing');};
  const move=(event:PointerInput)=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();const state=options.read();transform(dragViewport(state,{x:event.clientX-drag.x,y:event.clientY-drag.y}));drag={...drag,x:event.clientX,y:event.clientY};};
  const up=(event:PointerInput)=>{if(!drag||drag.id!==event.pointerId)return;drag=null;target?.style.setProperty('cursor','grab');try{target?.releasePointerCapture(event.pointerId);}catch{/* Capture may already be released. */}};
  const double=()=>transform(fittedViewport);
  const detach=()=>{if(!target)return;target.removeEventListener('wheel',wheel);target.removeEventListener('pointerdown',down);target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',up);target.removeEventListener('lostpointercapture',up);target.removeEventListener('dblclick',double);target=null;drag=null;};
  const bind=()=>{if(stopped)return;const next=env.document.querySelector(`[data-testid="${options.id}"]`) as InteractiveElement|null;if(next===target)return;detach();target=next;if(!target)return;target.style.setProperty('cursor','grab');target.style.setProperty('touch-action','none');target.style.setProperty('user-select','none');target.addEventListener('wheel',wheel,{passive:false});target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',up);target.addEventListener('lostpointercapture',up);target.addEventListener('dblclick',double);};
  const observer=new env.MutationObserver(bind);observer.observe(env.document.body,{childList:true,subtree:true});bind();return ()=>{stopped=true;observer.disconnect();detach();};
}

const imageNavigationOwners:string[]=[];
export function mountImageNavigation(options:{id:string;previous:()=>void;next:()=>void}):()=>void{
  const env=environment();if(!env)return ()=>{};
  const events=globalThis as unknown as WebEvents;
  imageNavigationOwners.push(options.id);
  const selector=(id:string)=>`[data-testid="${id}"]`;
  const keydown=(event:KeyboardInput)=>{
    if(event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    if(event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="menu"]'))return;
    const owner=[...imageNavigationOwners].reverse().find(id=>env.document.querySelector(selector(id)));
    if(owner!==options.id)return;
    const viewport=env.document.querySelector(selector(options.id));if(!viewport)return;
    const dialog=viewport.closest('[role="dialog"],[aria-modal="true"]');
    const top=Array.from(env.document.body.querySelectorAll('[role="dialog"],[aria-modal="true"]')).filter(node=>node.getAttribute('aria-hidden')!=='true'&&node.getBoundingClientRect().width>0).at(-1);
    if(dialog&&top&&!top.contains(viewport))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='ArrowLeft')options.previous();else options.next();
  };
  events.document.addEventListener('keydown',keydown,true);
  return ()=>{events.document.removeEventListener('keydown',keydown,true);const index=imageNavigationOwners.lastIndexOf(options.id);if(index!==-1)imageNavigationOwners.splice(index,1);};
}
