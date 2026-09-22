export type CastingMethod="numbers"|"random"|"coins";
export interface DivinationCastRequest { question:string; method:CastingMethod; numbers?:number[]; coins?:number[][]; time_range?:string }
export interface HexagramView { number:number; name:string; upper_trigram:string; lower_trigram:string; lines:Array<6|7|8|9> }
export interface MovingLineReading { line:number; text:string; commentary:string }
export interface HexagramReading {
  number:number;
  name:string;
  source_id:string;
  source_title:string;
  source_url:string;
  judgment:string;
  commentary:string;
  image:string;
  moving_lines:MovingLineReading[];
}
export interface DivinationReading {
  primary:HexagramReading;
  mutual:HexagramReading;
  transformed:HexagramReading;
  method_note:string;
  source_refs:Array<{source_id:string;title:string;url?:string}>;
}
export interface DivinationCastResult { primary:HexagramView; moving_lines:number[]; mutual:HexagramView; transformed:HexagramView; traditional_meaning:string; contextual_interpretation:string; reading?:DivinationReading }
export type ChatRole="user"|"assistant";
export interface DivinationChatMessage { role:ChatRole; content:string }
export interface DivinationChatRequest { messages:DivinationChatMessage[] }
export interface DivinationExtraction { source:"llm"|"rules"; question?:string; time_range?:string; method?:CastingMethod; numbers?:number[]; fallback_reason?:string }
export interface DivinationChatReply { status:"clarify"|"ready"; message:string; suggestions:string[]; cast_request?:DivinationCastRequest; extraction?:DivinationExtraction }
