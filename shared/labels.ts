// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export const DEFAULT_SMART_LABELS = [
	{
		id: "action_needed",
		name: "Action needed",
		description: "Needs a reply, decision, or concrete follow-up.",
		color: "#dc2626",
	},
	{
		id: "waiting",
		name: "Waiting",
		description: "You are waiting for someone else to respond or act.",
		color: "#d97706",
	},
	{
		id: "newsletter",
		name: "Newsletter",
		description: "Recurring editorial, digest, marketing, or list email.",
		color: "#2563eb",
	},
	{
		id: "notification",
		name: "Notification",
		description: "Automated product, account, or workflow notification.",
		color: "#4f46e5",
	},
	{
		id: "transaction",
		name: "Transaction",
		description: "Receipt, invoice, shipping, payment, or account transaction.",
		color: "#059669",
	},
	{
		id: "personal",
		name: "Personal",
		description: "Human personal or relationship-oriented message.",
		color: "#be185d",
	},
	{
		id: "low_priority",
		name: "Low priority",
		description: "Safe to read later; low urgency and low consequence.",
		color: "#64748b",
	},
] as const;

export type SmartLabelId = (typeof DEFAULT_SMART_LABELS)[number]["id"];

export const DEFAULT_SMART_LABEL_IDS = DEFAULT_SMART_LABELS.map(
	(label) => label.id,
) as readonly SmartLabelId[];

export function getSmartLabelName(labelId: string): string {
	return (
		DEFAULT_SMART_LABELS.find((label) => label.id === labelId)?.name ??
		labelId.replace(/_/g, " ")
	);
}
