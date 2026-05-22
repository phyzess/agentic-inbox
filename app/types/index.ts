// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	forwarding?: { enabled: boolean; email: string };
	signature?: SignatureSettings;
	autoReply?: { enabled: boolean; subject: string; message: string };
	agentSystemPrompt?: string;
	classification?: {
		enabled?: boolean;
		autoDraftAfterClassify?: boolean;
		lowConfidenceThreshold?: number;
	};
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	settings?: MailboxSettings;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	labels?: EmailLabel[];
	classification?: ClassificationResult;
	snippet?: string | null;
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}

export interface Label {
	id: string;
	name: string;
	description?: string | null;
	color?: string | null;
	isSystem?: boolean;
	totalCount?: number;
	unreadCount?: number;
}

export interface EmailLabel extends Label {
	source: "ai" | "rule" | "manual" | string;
	confidence?: number | null;
	reason?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

export interface ClassificationResult {
	emailId: string;
	status: "unclassified" | "processing" | "classified" | "error";
	errorMessage?: string | null;
	classifiedAt?: string | null;
	updatedAt?: string | null;
	labels: EmailLabel[];
	suggestedRule?: ClassificationRule;
}

export interface ClassificationRule {
	id: string;
	label_id: string;
	label_name?: string;
	label_color?: string;
	field: string;
	operator: string;
	value: string;
	status: "suggested" | "active" | "disabled";
	created_at?: string;
	updated_at?: string;
}

export interface ClassificationFeedback {
	id: string;
	email_id: string;
	from_label_id?: string | null;
	to_label_id: string;
	reason?: string | null;
	created_at?: string;
}
