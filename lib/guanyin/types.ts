export const questionDomains = ["career", "marriage", "wealth", "health", "family", "travel"] as const;

export type QuestionDomain = (typeof questionDomains)[number];

export const guanyinQuestionIntents = ["general", "timing", "advance_or_wait", "career_change", "relocation", "travel_start", "transaction", "relationship_commitment", "obligation_fulfillment", "credibility_check", "risk_assessment", "family_change", "treatment_change"] as const;
export type GuanyinQuestionIntent = (typeof guanyinQuestionIntents)[number];

export interface GuanyinQuestionAnalysis {
  primaryIntent: GuanyinQuestionIntent;
  intents: readonly GuanyinQuestionIntent[];
  matchedTerms: readonly string[];
  safetyFlags: readonly ("medical_decision" | "financial_decision" | "relationship_decision")[];
}

export function isQuestionDomain(value: unknown): value is QuestionDomain {
  return typeof value === "string" && (questionDomains as readonly string[]).includes(value);
}

export interface TraditionalInterpretation {
  jieyue: string;
  xianji: string;
  topics: Record<QuestionDomain, string>;
  diangu: string;
}

export interface GuanyinStick {
  id: number;
  level: string;
  title: string;
  poem: [string, string, string, string];
  traditional: TraditionalInterpretation;
}

export interface DrawRecord {
  drawId: string;
  question: string;
  domain: QuestionDomain;
  stickNumber: number;
  drawnAt: string;
  oracleVersion: "0.1.0";
  randomMethod: "server-crypto-random-int";
  reasoning: GuanyinStructuredReasoning;
  evidenceIntegration: GuanyinEvidenceIntegration;
  llmGeneration: GuanyinLlmGeneration;
}

export const semanticTagTypes = ["theme", "action", "pattern", "symbol", "time", "risk"] as const;
export type SemanticTagType = (typeof semanticTagTypes)[number];
export type TagEvidenceType = "poem" | "jieyue" | "xianji" | "topic" | "diangu" | "editorial";
export type TagAssignmentMethod = "explicit" | "rule" | "human" | "ai_suggested";
export type TagReviewStatus = "pending" | "reviewed" | "rejected";

export interface SemanticTagDefinition {
  id: string;
  label: string;
  type: SemanticTagType;
  description: string;
  aliases: string[];
  parentId?: string;
}

export interface GuanyinTagAssignment {
  tagId: string;
  evidenceType: TagEvidenceType;
  evidenceText: string;
  sourceId: string;
  confidence: number;
  method: TagAssignmentMethod;
  reviewStatus: TagReviewStatus;
  domains?: readonly QuestionDomain[];
  intents?: readonly GuanyinQuestionIntent[];
}

export type TagReviewDecision = "accept" | "reject" | "change_tag" | "lower_confidence";
export interface GuanyinTagReviewException {
  signId: number;
  tagId: string;
  sourceId: string;
  decision: TagReviewDecision;
  proposedTagId?: string;
  proposedConfidence?: number;
  reason: string;
}

export interface GuanyinSignSemanticProfile {
  signId: number;
  tags: GuanyinTagAssignment[];
}

export interface GuanyinSemanticEvidenceItem {
  tag: SemanticTagDefinition;
  evidenceType: TagEvidenceType;
  evidenceText: string;
  sourceId: string;
  confidence: number;
  method: TagAssignmentMethod;
  domains?: readonly QuestionDomain[];
  intents?: readonly GuanyinQuestionIntent[];
}

export interface GuanyinSemanticEvidenceResult {
  signId: number;
  domain: QuestionDomain;
  coverage: "reviewed" | "unavailable";
  tags: readonly GuanyinSemanticEvidenceItem[];
}

export interface GuanyinReasoningStatement {
  text: string;
  tagIds: readonly string[];
  sourceIds: readonly string[];
}

export interface GuanyinPracticalGuidance {
  text: string;
  basis: "system_safety";
  category: "decision_safety" | "relationship_safety" | "health_safety" | "financial_safety";
}

export interface GuanyinStructuredReasoning {
  signId: number;
  domain: QuestionDomain;
  question: string;
  questionAnalysis: GuanyinQuestionAnalysis;
  coverage: "reviewed" | "unavailable";
  coreJudgment: GuanyinReasoningStatement | null;
  themes: readonly GuanyinReasoningStatement[];
  trends: readonly GuanyinReasoningStatement[];
  actions: readonly GuanyinReasoningStatement[];
  risks: readonly GuanyinReasoningStatement[];
  timing: readonly GuanyinReasoningStatement[];
  symbols: readonly GuanyinReasoningStatement[];
  primarySafetyAnswer: GuanyinPracticalGuidance | null;
  practicalGuidance: readonly GuanyinPracticalGuidance[];
  uncertainties: readonly string[];
  evidence: readonly GuanyinSemanticEvidenceItem[];
}

export type GuanyinIntegratedEvidenceType = "drawn_oracle" | "system_safety" | "traditional_context";

export interface GuanyinIntegratedClaim {
  text: string;
  tagIds: readonly string[];
  sourceIds: readonly string[];
}

export interface GuanyinIntegratedEvidenceReference {
  sourceId: string;
  type: GuanyinIntegratedEvidenceType;
  recommendedUse: "direct" | "context_only";
  title: string;
  text: string;
  url: string | null;
  boundary: string;
  tagIds: readonly string[];
  conceptIds: readonly string[];
}

export interface GuanyinEvidenceIntegration {
  version: "guanyin-evidence-integration-1.0.0";
  status: "ready" | "reasoning_unavailable";
  precedence: readonly ["system_safety", "structured_reasoning", "drawn_oracle", "traditional_context"];
  coreJudgment: GuanyinIntegratedClaim | null;
  actions: readonly GuanyinIntegratedClaim[];
  trends: readonly GuanyinIntegratedClaim[];
  risks: readonly GuanyinIntegratedClaim[];
  safetyGuidance: readonly string[];
  uncertainties: readonly string[];
  evidence: readonly GuanyinIntegratedEvidenceReference[];
  forbiddenClaims: readonly string[];
}

export interface GuanyinLlmGeneration {
  status: "pending" | "generated" | "insufficient_evidence" | "not_configured" | "integration_unavailable" | "failed";
  request: GuanyinLlmGenerationRequest;
  explanation: GuanyinLlmExplanation | null;
  model: string | null;
  warning: string | null;
}

export interface GuanyinDrawResult {
  stick: GuanyinStick;
  question: string;
  domain: QuestionDomain;
  drawn_at: string;
  reasoning: GuanyinStructuredReasoning;
  evidence_integration: GuanyinEvidenceIntegration;
  llm_generation: GuanyinLlmGeneration;
}
import type { GuanyinLlmExplanation, GuanyinLlmGenerationRequest } from "./llm-explanation";
