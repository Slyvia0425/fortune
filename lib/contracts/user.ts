export interface SessionEventRequest { session_id:string; event_id?:string; event_type:string; module:"bazi"|"divination"|"guanyin"|"knowledge"; payload?:Record<string,unknown>; occurred_at?:string; sequence_no?:number }
export interface UserNoteRequest { note_id?:string; user_id?:string; title:string; content:string; tags?:string[]; source_ref?:string; action?:"create"|"update"|"delete" }
export interface UserNote { note_id:string; title:string; content:string; tags:string[]; source_ref?:string; updated_at:string }
