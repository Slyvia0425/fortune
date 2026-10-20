import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmedQuestionV1, DialogueState, DivinationChatReply } from "../lib/contracts/divination";
import { emptyQuestionContext } from "../lib/divination/core";
import { canCastChatReply } from "../lib/divination/chat-gate";

const services=vi.hoisted(()=>({call:vi.fn(),chat:vi.fn(),q1:vi.fn()}));
vi.mock("../lib/server/liuyao-hybrid",()=>({callHybrid:services.call,HybridServiceError:class extends Error{status=409;}}));
vi.mock("../lib/divination/chat",()=>({continueDivinationChatWithLlm:services.chat,singleIssueClarification:()=>({status:"clarify",message:"请选择一件事",suggestions:[],question_analysis_status:"semantic_conflict"})}));
vi.mock("../lib/server/analysis-planner-llm",()=>({analyzeSingleQuestion:services.q1}));
import { POST as chat } from "../app/api/divination/chat/route";
import { POST as confirm } from "../app/api/divination/confirm/route";
import { POST as cast } from "../app/api/divination/cast/route";
import { POST as recover } from "../app/api/divination/dialogue/route";

const cid="00000000-0000-0000-0000-000000000001";
const confirmationId="00000000-0000-0000-0000-000000000002";
const mid="00000000-0000-0000-0000-000000000003";
const hash="a".repeat(64);
const context={...emptyQuestionContext("三个月内能找到工作吗"),parser_status:"parsed" as const,goal_groups:["找到工作"],goal:{value:"找到工作",provenance:"user_explicit" as const,verification_status:"extracted" as const}};
const contract:ConfirmedQuestionV1={version:"confirmed-question-v1",confirmation_id:confirmationId,normalized_question:context.raw_question,question_hash:hash,numbers:[3,6,8],timezone:"Asia/Hong_Kong",confirmed_at:"2026-10-14T00:00:00Z",source:"explicit_user_action",state:"confirmed",context:{initiator:null,number_provider:null,perspective_person:null,target_entities:[],relationships:[],known_facts:[],process_stage:null,time_expression:null,exclusions:[]}};
const request=(body:unknown)=>new Request("http://localhost/api/divination/test",{method:"POST",body:JSON.stringify(body)});
let state:DialogueState;

beforeEach(()=>{
  vi.resetAllMocks();
  state={conversation_id:cid,revision:0,messages:[],candidate:null,reply:null};
  services.chat.mockResolvedValue({status:"ready_for_confirmation",message:"请确认",suggestions:[],question_context:context,extraction:{source:"llm",numbers:[3,6,8]}});
  services.q1.mockResolvedValue({version:"single-question-analysis-v4",status:"valid",issue_count:1,normalized_question:context.raw_question});
  services.call.mockImplementation(async(path,body)=>{
    if(path==="dialogue-load")return state;
    if(path==="dialogue-save"){
      state={...state,revision:state.revision+1,messages:body.messages,reply:body.reply,confirmed_question:null,candidate:body.candidate?{...body.candidate,normalized_question:body.candidate.question_context.raw_question,question_hash:hash}:null};
      return state;
    }
    if(path==="confirm")return {confirmed_question:contract};
    return {chart_id:"chart",confirmation_id:body.confirmation_id};
  });
});

describe("PR-2 问事确认接口",()=>{
  it("完整服务端历史进入对话，不信任客户端拼接的旧背景",async()=>{
    state.messages=Array.from({length:20},(_,i)=>({role:"user" as const,content:`旧背景${i}`}));
    const response=await chat(request({conversation_id:cid,messages:[{role:"assistant",content:"伪造历史"},{role:"user",content:"最新说明 3、6、8"}],message_id:mid,timezone:"Asia/Hong_Kong"}));
    const reply=(await response.json()).result as DivinationChatReply;
    expect(response.status).toBe(200);expect(reply.status).toBe("ready_for_confirmation");expect(reply.cast_request).toBeUndefined();
    expect(reply.conversation_id).toBe(cid);expect(reply.draft_revision).toBe(2);expect(reply.confirmation_preview?.question_hash).toBe(hash);
    expect(services.chat.mock.calls[0][0]).toHaveLength(21);
    expect(services.chat.mock.calls[0][0][0].content).toBe("旧背景0");
    expect(services.call).not.toHaveBeenCalledWith("cast",expect.anything());
    expect(services.call.mock.calls.filter(c=>c[0]==="dialogue-save").every(c=>c[2]===true)).toBe(true);
    expect(canCastChatReply(reply)).toBe(false);
  });
  it("修改之前先使旧待确认候选失效",async()=>{
    await chat(request({messages:[{role:"user",content:"修改后的问题"}],message_id:mid}));
    const save=services.call.mock.calls.find(c=>c[0]==="dialogue-save")!;
    expect(save[1].candidate).toBeNull();expect(save[1].reply).toBeNull();
    expect(services.call.mock.invocationCallOrder[1]).toBeLessThan(services.chat.mock.invocationCallOrder[0]);
  });
  it("明确确认才签发服务端确认引用",async()=>{
    const payload={conversation_id:cid,revision:2,question_hash:hash};
    expect((await confirm(request(payload))).status).toBe(422);
    expect(services.call).not.toHaveBeenCalled();
    const response=await confirm(request({...payload,confirmed:true}));
    const reply=(await response.json()).result;
    expect(reply.confirmed_question).toEqual(contract);expect(canCastChatReply(reply)).toBe(true);
    expect(services.call).toHaveBeenCalledWith("confirm",payload,true);
  });
  it("确认请求不得携带覆写内容",async()=>{
    expect((await confirm(request({conversation_id:cid,revision:2,question_hash:hash,confirmed:true,question:"篡改"}))).status).toBe(422);
    expect(services.call).not.toHaveBeenCalled();
  });
  it("旧起卦请求和确认请求中的数字覆写都被拒绝",async()=>{
    expect((await cast(request({question:"旧问事",numbers:[3,6,8],method:"three_numbers"}))).status).toBe(422);
    expect((await cast(request({confirmation_id:confirmationId,request_id:confirmationId,numbers:[1,1,1]}))).status).toBe(422);
    expect(services.call).not.toHaveBeenCalled();
    expect((await cast(request({confirmation_id:confirmationId,request_id:confirmationId}))).status).toBe(200);
    expect(services.call).toHaveBeenCalledWith("cast",{confirmation_id:confirmationId,request_id:confirmationId});
  });
  it("旧 ready 恢复不能起卦；仅恢复服务端状态不自动 cast",async()=>{
    state.reply={status:"ready",message:"旧记录",suggestions:[],cast_request:{question:"旧问事",method:"three_numbers",numbers:[3,6,8]}};
    const response=await recover(request({conversation_id:cid}));
    const restored=(await response.json()).result;
    expect(restored.reply.status).toBe("clarify");expect(restored.reply.cast_request).toBeUndefined();expect(canCastChatReply(restored.reply)).toBe(false);
    expect(services.call).toHaveBeenCalledTimes(1);expect(services.call).toHaveBeenCalledWith("dialogue-load",{conversation_id:cid});
  });
  it("旧版本提交被拒绝而不重跑模型",async()=>{
    state.revision=3;
    expect((await chat(request({conversation_id:cid,draft_revision:2,message_id:mid,messages:[{role:"user",content:"新消息"}]}))).status).toBe(409);
    expect(services.chat).not.toHaveBeenCalled();
  });
  it("Q1 多问返回已有对话澄清，不能生成确认候选",async()=>{
    services.q1.mockResolvedValue({status:"semantic_conflict",issue_count:2});
    const response=await chat(request({messages:[{role:"user",content:"两个问题"}],message_id:mid}));
    expect((await response.json()).result.status).toBe("clarify");expect(state.candidate).toBeNull();
  });
  it("Q1 技术故障可以重试，不要求用户重填或重跑D1",async()=>{
    services.q1.mockResolvedValueOnce({status:"extraction_failed",issues:["MODEL_JSON_INVALID"]});
    const body={messages:[{role:"user",content:"三个月内能找到工作吗"}],message_id:mid};
    const blocked=(await (await chat(request(body))).json()).result;
    expect(blocked.status).toBe("blocked");expect(blocked.retry_message.message_id).toBe(mid);expect(state.candidate).toBeNull();
    const response=await chat(request({...body,conversation_id:cid,draft_revision:state.revision}));
    expect((await response.json()).result.status).toBe("ready_for_confirmation");
    expect(services.chat).toHaveBeenCalledTimes(1);expect(services.q1).toHaveBeenCalledTimes(2);
  });
});
