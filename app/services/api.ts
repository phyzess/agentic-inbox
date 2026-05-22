// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ClassificationResult, ClassificationRule, Email, Folder, Label, Mailbox, TriageEvent, TriageStatus } from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	classifyEmail: (mailboxId: string, id: string, force = true) =>
		post<ClassificationResult>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/classify`, { force }),
	applyLabel: (mailboxId: string, id: string, labelId: string, reason?: string) =>
		post<ClassificationResult>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/label`, { labelId, reason }),
	getClassification: (mailboxId: string, id: string) =>
		get<ClassificationResult>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/classification`),
	getTriageStatus: (mailboxId: string) =>
		get<TriageStatus>(`/api/v1/mailboxes/${mailboxId}/triage/status`),
	listTriageActivity: (mailboxId: string, limit = 25) =>
		get<TriageEvent[]>(`/api/v1/mailboxes/${mailboxId}/triage/activity`, {
			params: { limit: String(limit) },
		}),
	undoTriageActivity: (mailboxId: string, eventId: string) =>
		post<TriageEvent>(`/api/v1/mailboxes/${mailboxId}/triage/activity/${eventId}/undo`),
	suggestRule: (mailboxId: string, id: string, labelId?: string) =>
		post<ClassificationRule>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/suggest-rule`, { labelId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Smart labels
	listLabels: (mailboxId: string) =>
		get<Label[]>(`/api/v1/mailboxes/${mailboxId}/labels`),
	listRules: (mailboxId: string) =>
		get<ClassificationRule[]>(`/api/v1/mailboxes/${mailboxId}/rules`),
	confirmRule: (mailboxId: string, ruleId: string) =>
		post<ClassificationRule>(`/api/v1/mailboxes/${mailboxId}/rules/${ruleId}/confirm`),
	disableRule: (mailboxId: string, ruleId: string) =>
		post<ClassificationRule>(`/api/v1/mailboxes/${mailboxId}/rules/${ruleId}/disable`),
	backfillTriage: (
		mailboxId: string,
		body: { folder?: string; limit?: number; page?: number; force?: boolean },
	) => post<{ status: string; queued: number; emailIds: string[] }>(
		`/api/v1/mailboxes/${mailboxId}/triage/backfill`,
		body,
	),
	bulkFileLabel: (mailboxId: string, labelId: string, limit = 100) =>
		post<{ labelId: string; folderId: string; moved: number; emailIds: string[] }>(
			`/api/v1/mailboxes/${mailboxId}/triage/bulk/file-label`,
			{ labelId, limit },
		),
	bulkMarkLabelRead: (mailboxId: string, labelId: string, limit = 100) =>
		post<{ labelId: string; markedRead: number; emailIds: string[] }>(
			`/api/v1/mailboxes/${mailboxId}/triage/bulk/mark-read`,
			{ labelId, limit },
		),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),
};

export default api;
