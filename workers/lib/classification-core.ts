// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DEFAULT_SMART_LABEL_IDS, getSmartLabelName } from "../../shared/labels";

export interface ClassificationChoice {
	labelId: string;
	confidence: number;
	reason: string;
}

export interface RuleLike {
	field: string;
	operator: string;
	value: string;
}

export interface EmailForRules {
	sender?: string | null;
	recipient?: string | null;
	subject?: string | null;
	body?: string | null;
	raw_headers?: string | null;
}

const LABEL_SET = new Set<string>(DEFAULT_SMART_LABEL_IDS);

export function clampConfidence(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return 0.5;
	return Math.max(0, Math.min(1, parsed));
}

export function parseClassificationResponse(raw: string): ClassificationChoice {
	const fallback = {
		labelId: "low_priority",
		confidence: 0.35,
		reason: "The classifier did not return a valid label.",
	};

	try {
		const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
		const parsed = JSON.parse(jsonText) as {
			labelId?: unknown;
			label_id?: unknown;
			label?: unknown;
			confidence?: unknown;
			reason?: unknown;
		};
		const labelId = String(
			parsed.labelId ?? parsed.label_id ?? parsed.label ?? "",
		).trim();
		if (!LABEL_SET.has(labelId)) return fallback;
		const reason =
			typeof parsed.reason === "string" && parsed.reason.trim()
				? parsed.reason.trim().slice(0, 500)
				: `Classified as ${getSmartLabelName(labelId)}.`;
		return {
			labelId,
			confidence: clampConfidence(parsed.confidence),
			reason,
		};
	} catch {
		return fallback;
	}
}

export function senderDomain(sender: string | null | undefined): string | null {
	const domain = sender?.toLowerCase().split("@")[1]?.trim();
	return domain || null;
}

export function buildSuggestedSenderDomainRule(
	email: EmailForRules,
	labelId: string,
) {
	const domain = senderDomain(email.sender);
	if (domain) {
		return {
			labelId,
			field: "sender_domain",
			operator: "equals",
			value: domain,
		};
	}
	const sender = email.sender?.toLowerCase().trim();
	if (!sender) return null;
	return {
		labelId,
		field: "sender",
		operator: "equals",
		value: sender,
	};
}

export function ruleMatchesEmail(rule: RuleLike, email: EmailForRules): boolean {
	const value = rule.value.toLowerCase().trim();
	if (!value) return false;

	let target = "";
	switch (rule.field) {
		case "sender":
			target = email.sender ?? "";
			break;
		case "sender_domain":
			target = senderDomain(email.sender) ?? "";
			break;
		case "recipient":
			target = email.recipient ?? "";
			break;
		case "subject":
			target = email.subject ?? "";
			break;
		case "body":
			target = email.body ?? "";
			break;
		case "list_id":
			target = email.raw_headers ?? "";
			break;
		default:
			return false;
	}

	const normalizedTarget = target.toLowerCase();
	switch (rule.operator) {
		case "equals":
			return normalizedTarget.trim() === value;
		case "contains":
			return normalizedTarget.includes(value);
		case "starts_with":
			return normalizedTarget.trim().startsWith(value);
		default:
			return false;
	}
}

export function buildClassificationPrompt(input: {
	sender?: string | null;
	recipient?: string | null;
	subject?: string | null;
	bodyText: string;
}) {
	return `Classify this email into exactly one smart label.

Labels:
- action_needed: needs a reply, decision, or concrete follow-up from the mailbox owner
- waiting: the mailbox owner is waiting for someone else to respond or act
- newsletter: recurring editorial, digest, marketing, or list email
- notification: automated product, account, or workflow notification
- transaction: receipt, invoice, shipping, payment, or account transaction
- personal: human personal or relationship-oriented message
- low_priority: safe to read later; low urgency and low consequence

Return only JSON with this shape:
{"labelId":"one_label_id","confidence":0.0,"reason":"short explanation"}

Email:
From: ${input.sender || "(unknown)"}
To: ${input.recipient || "(unknown)"}
Subject: ${input.subject || "(no subject)"}
Body:
${input.bodyText.slice(0, 6000)}`;
}
