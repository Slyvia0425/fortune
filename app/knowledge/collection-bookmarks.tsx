"use client";

import Link from "next/link";
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from "react";
import {module4Api,Module4ApiError} from "@/lib/module4/api";
import type {CollectionItem} from "@/lib/module4/types";

export type BookmarkInput={sourceId:string;itemType:"knowledge_item"|"knowledge_passage"|"knowledge_concept"|"knowledge_term";title:string;sourceUrl:string;checksum:string;parentSourceId?:string;anchor?:string;excerpt?:string;sourceVersion?:string};
type BookmarkState={collections:CollectionItem[];loading:boolean;unauthorized:boolean;unavailable:boolean;toggle:(input:BookmarkInput)=>Promise<"saved"|"removed"|"updated"|"duplicate">};
const BookmarkContext=createContext<BookmarkState|null>(null);
const SYNC_EVENT="fortune:collections-changed";

export function CollectionBookmarkProvider({children}:{children:ReactNode}){
  const[collections,setCollections]=useState<CollectionItem[]>([]),[loading,setLoading]=useState(true),[unauthorized,setUnauthorized]=useState(false),[unavailable,setUnavailable]=useState(false);
  const refresh=useCallback(async()=>{try{const result=await module4Api.listCollections("");setCollections(result);setUnauthorized(false);setUnavailable(false)}catch(error){if(error instanceof Module4ApiError&&error.status===401)setUnauthorized(true);else setUnavailable(true)}finally{setLoading(false)}},[]);
  useEffect(()=>{queueMicrotask(()=>void refresh());const sync=()=>void refresh();window.addEventListener(SYNC_EVENT,sync);let channel:BroadcastChannel|null=null;if("BroadcastChannel" in window){channel=new BroadcastChannel(SYNC_EVENT);channel.onmessage=sync}return()=>{window.removeEventListener(SYNC_EVENT,sync);channel?.close()}},[refresh]);
  const announce=()=>{window.dispatchEvent(new Event(SYNC_EVENT));if("BroadcastChannel" in window){const channel=new BroadcastChannel(SYNC_EVENT);channel.postMessage("refresh");channel.close()}};
  const toggle=useCallback(async(input:BookmarkInput)=>{const existing=collections.find(item=>item.source_id===input.sourceId&&item.item_type===input.itemType);const oldChecksum=typeof existing?.source_metadata?.content_checksum==="string"?existing.source_metadata.content_checksum:null;const changed=Boolean(existing&&oldChecksum&&oldChecksum!==input.checksum);if(existing&&!changed){await module4Api.deleteCollection("",existing.collection_id);setCollections(items=>items.filter(item=>item.collection_id!==existing.collection_id));announce();return"removed" as const}if(existing&&changed)await module4Api.deleteCollection("",existing.collection_id);const created=await module4Api.createCollection("",{itemType:input.itemType,sourceId:input.sourceId,title:input.title,sourceUrl:input.sourceUrl,metadata:{parent_source_id:input.parentSourceId??null,anchor:input.anchor??null,excerpt:input.excerpt??null,content_checksum:input.checksum,source_version:input.sourceVersion??"knowledge-corpus-v2",saved_from:"module3"}});setCollections(items=>[created,...items.filter(item=>item.collection_id!==existing?.collection_id)]);announce();return changed?"updated" as const:"saved" as const},[collections]);
  const value=useMemo(()=>({collections,loading,unauthorized,unavailable,toggle}),[collections,loading,unauthorized,unavailable,toggle]);
  return <BookmarkContext.Provider value={value}>{children}</BookmarkContext.Provider>
}

export function CollectionBookmark({input,compact=false}:{input:BookmarkInput;compact?:boolean}){
  const context=useContext(BookmarkContext);const[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  if(!context)return null;const item=context.collections?.find(entry=>entry.source_id===input.sourceId&&entry.item_type===input.itemType);const stored=typeof item?.source_metadata?.content_checksum==="string"?item.source_metadata.content_checksum:null;const updated=Boolean(item&&stored&&stored!==input.checksum);
  if(context.unauthorized)return compact?<Link className="bookmark-login compact" href="/account" title="登录后收藏">☆</Link>:<Link className="bookmark-login" href="/account">登录后收藏</Link>;
  if(context.unavailable)return compact?null:<span className="bookmark-unavailable">收藏服务暂不可用</span>;
  const label=busy?"…":compact?(updated?"↻":item?"★":"☆"):(updated?"↻ 来源已更新":item?"★ 已收藏":"☆ 收藏");
  return <span className={`collection-control ${compact?"compact":""}`}><button type="button" disabled={busy||context.loading} className={`${item?"saved":""} ${updated?"updated":""}`} aria-label={updated?"来源内容已有更新，点击更新收藏":item?"取消收藏":"保存到我的藏书"} title={updated?"来源内容已有更新，点击更新收藏":item?"取消收藏":"保存到我的藏书"} onClick={async event=>{event.stopPropagation();setBusy(true);try{const status=await context.toggle(input);setMessage(status==="saved"?"已收藏":status==="updated"?"收藏已更新":status==="removed"?"已取消":"已收藏")}catch(error){setMessage(error instanceof Module4ApiError&&error.status===401?"请先登录":error instanceof Module4ApiError&&error.status===404?"资料不存在":"操作失败")}finally{setBusy(false);window.setTimeout(()=>setMessage(""),1800)}}}>{label}</button>{message&&<small role="status">{message}</small>}</span>
}
