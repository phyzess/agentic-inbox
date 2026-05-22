// Lightweight smoke tests for smart-triage pure behavior.
// Uses Node's built-in test runner so the repo does not need a test framework.
import assert from "node:assert/strict";
import test from "node:test";

const validLabels = new Set([
	"action_needed",
	"waiting",
	"newsletter",
	"notification",
	"transaction",
	"personal",
	"low_priority",
]);

function parseClassificationResponse(raw) {
	const fallback = {
		labelId: "low_priority",
		confidence: 0.35,
		reason: "The classifier did not return a valid label.",
	};
	try {
		const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
		const parsed = JSON.parse(jsonText);
		const labelId = String(
			parsed.labelId ?? parsed.label_id ?? parsed.label ?? "",
		).trim();
		if (!validLabels.has(labelId)) return fallback;
		return {
			labelId,
			confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
			reason: parsed.reason || `Classified as ${labelId}.`,
		};
	} catch {
		return fallback;
	}
}

function senderDomain(sender) {
	return sender?.toLowerCase().split("@")[1]?.trim() || null;
}

function ruleMatchesEmail(rule, email) {
	const value = rule.value.toLowerCase().trim();
	const target = rule.field === "sender_domain"
		? senderDomain(email.sender) ?? ""
		: email[rule.field] ?? "";
	if (rule.operator === "equals") return target.toLowerCase().trim() === value;
	if (rule.operator === "contains") return target.toLowerCase().includes(value);
	return false;
}

test("parses a valid classifier JSON response", () => {
	assert.deepEqual(
		parseClassificationResponse(
			'{"labelId":"newsletter","confidence":0.82,"reason":"Digest email"}',
		),
		{ labelId: "newsletter", confidence: 0.82, reason: "Digest email" },
	);
});

test("falls back for invalid labels", () => {
	assert.equal(
		parseClassificationResponse(
			'{"labelId":"totally_unknown","confidence":1,"reason":"bad"}',
		).labelId,
		"low_priority",
	);
});

test("matches sender-domain rules", () => {
	assert.equal(
		ruleMatchesEmail(
			{ field: "sender_domain", operator: "equals", value: "example.com" },
			{ sender: "news@example.com" },
		),
		true,
	);
});
