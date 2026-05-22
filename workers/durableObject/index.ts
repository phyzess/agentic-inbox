// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import { stripHtmlToText } from "../lib/email-helpers";
import {
	buildClassificationPrompt,
	buildSuggestedSenderDomainRule,
	parseClassificationResponse,
	ruleMatchesEmail,
	type ClassificationChoice,
	type EmailForRules,
} from "../lib/classification-core";
import type { Env } from "../types";
import { applyMigrations, mailboxMigrations } from "./migrations";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * Map SortColumn string names to Drizzle column references for safe
 * ORDER BY construction (no string interpolation into SQL).
 */
const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, typeof schema.emails[keyof typeof schema.emails]>;

interface SearchFilterOptions {
	query: string;
	folder?: string;
	label?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

interface GetEmailsOptions {
	folder?: string;
	label?: string;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

interface EmailLabelRow {
	id: string;
	name: string;
	description?: string | null;
	color?: string | null;
	source: string;
	confidence?: number | null;
	reason?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

type ClassificationStatus = "unclassified" | "processing" | "classified" | "error";

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
	}

	// ── Smart labels and classification helpers ─────────────────────

	async #getLabelsForEmailIds(emailIds: string[]) {
		const map = new Map<string, EmailLabelRow[]>();
		if (emailIds.length === 0) return map;

		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT el.email_id, l.id, l.name, l.description, l.color,
				        el.source, el.confidence, el.reason, el.created_at, el.updated_at
				 FROM email_labels el
				 JOIN labels l ON l.id = el.label_id
				 WHERE el.email_id IN (${placeholders})
				 ORDER BY COALESCE(el.confidence, 0) DESC, el.updated_at DESC`,
				...emailIds,
			),
		] as unknown as (EmailLabelRow & { email_id: string })[];

		for (const row of rows) {
			const list = map.get(row.email_id) ?? [];
			list.push({
				id: row.id,
				name: row.name,
				description: row.description,
				color: row.color,
				source: row.source,
				confidence: row.confidence,
				reason: row.reason,
				created_at: row.created_at,
				updated_at: row.updated_at,
			});
			map.set(row.email_id, list);
		}
		return map;
	}

	async #decorateEmailsWithLabels<T extends { id: string }>(rows: T[]) {
		const labelsByEmail = await this.#getLabelsForEmailIds(rows.map((row) => row.id));
		return rows.map((row) => ({
			...row,
			labels: labelsByEmail.get(row.id) ?? [],
		}));
	}

	#recordClassificationStatus(
		emailId: string,
		status: ClassificationStatus,
		error?: string | null,
	) {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`INSERT INTO email_classifications
				(email_id, status, error, classified_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)
			 ON CONFLICT(email_id) DO UPDATE SET
				status = excluded.status,
				error = excluded.error,
				classified_at = excluded.classified_at,
				updated_at = excluded.updated_at`,
			emailId,
			status,
			error ?? null,
			status === "classified" || status === "error" ? now : null,
			now,
		);
	}

	async getLabels() {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT l.id, l.name, l.description, l.color, l.is_system,
				        COUNT(el.email_id) as totalCount,
				        COALESCE(SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END), 0) as unreadCount
				 FROM labels l
				 LEFT JOIN email_labels el ON el.label_id = l.id
				 LEFT JOIN emails e ON e.id = el.email_id
				 GROUP BY l.id, l.name, l.description, l.color, l.is_system
				 ORDER BY l.is_system DESC, l.name ASC`,
			),
		] as any[];

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			color: row.color,
			isSystem: !!row.is_system,
			totalCount: Number(row.totalCount ?? 0),
			unreadCount: Number(row.unreadCount ?? 0),
		}));
	}

	async getClassification(emailId: string) {
		const classification = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM email_classifications WHERE email_id = ?1`,
				emailId,
			),
		][0] as Record<string, unknown> | undefined;
		const labels = await this.#getLabelsForEmailIds([emailId]);
		return {
			emailId,
			status: classification?.status ?? "unclassified",
			errorMessage: classification?.error ?? null,
			classifiedAt: classification?.classified_at ?? null,
			updatedAt: classification?.updated_at ?? null,
			labels: labels.get(emailId) ?? [],
		};
	}

	async applyEmailLabel(
		emailId: string,
		labelId: string,
		options: {
			source?: "ai" | "rule" | "manual";
			confidence?: number | null;
			reason?: string | null;
			replace?: boolean;
		} = {},
	) {
		const emailExists = [
			...this.ctx.storage.sql.exec(`SELECT 1 FROM emails WHERE id = ?1`, emailId),
		].length > 0;
		if (!emailExists) return { error: "Email not found" };

		const labelExists = [
			...this.ctx.storage.sql.exec(`SELECT 1 FROM labels WHERE id = ?1`, labelId),
		].length > 0;
		if (!labelExists) return { error: "Label not found" };

		if (options.replace ?? true) {
			this.ctx.storage.sql.exec(`DELETE FROM email_labels WHERE email_id = ?1`, emailId);
		}

		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`INSERT INTO email_labels
				(email_id, label_id, source, confidence, reason, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
			 ON CONFLICT(email_id, label_id) DO UPDATE SET
				source = excluded.source,
				confidence = excluded.confidence,
				reason = excluded.reason,
				updated_at = excluded.updated_at`,
			emailId,
			labelId,
			options.source ?? "manual",
			options.confidence ?? null,
			options.reason ?? null,
			now,
		);
		this.#recordClassificationStatus(emailId, "classified", null);
		return this.getClassification(emailId);
	}

	async #matchingActiveRule(email: EmailForRules) {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM classification_rules
				 WHERE status = 'active'
				 ORDER BY updated_at DESC`,
			),
		] as any[];
		return rows.find((rule) => ruleMatchesEmail(rule, email)) ?? null;
	}

	async #runAiClassification(email: EmailData): Promise<ClassificationChoice> {
		const bodyText = stripHtmlToText(email.body ?? "");
		const response = (await this.env.AI.run(
			// @ts-expect-error — model string may lag generated Workers types
			"@cf/meta/llama-3.1-8b-instruct-fast",
			{
				messages: [
					{
						role: "system",
						content:
							"You are a careful email triage classifier. Return only valid JSON.",
					},
					{
						role: "user",
						content: buildClassificationPrompt({
							sender: email.sender,
							recipient: email.recipient,
							subject: email.subject,
							bodyText,
						}),
					},
				],
				max_tokens: 512,
				temperature: 0,
			},
		)) as { response?: string };

		return parseClassificationResponse(response?.response ?? "");
	}

	async classifyEmail(emailId: string, options: { force?: boolean; lowConfidenceThreshold?: number } = {}) {
		if (!options.force) {
			const current = await this.getClassification(emailId);
			if (current.status === "classified" && current.labels.length > 0) {
				return current;
			}
		}

		const email = (await this.getEmail(emailId)) as (EmailData & {
			folder_id?: string;
		}) | null;
		if (!email) return { error: "Email not found" };

		this.#recordClassificationStatus(emailId, "processing", null);

		try {
			const activeRule = await this.#matchingActiveRule(email);
			if (activeRule) {
				console.log(
					`AI triage rule hit: ${activeRule.id} -> ${activeRule.label_id}`,
				);
				return this.applyEmailLabel(emailId, activeRule.label_id, {
					source: "rule",
					confidence: 1,
					reason: `Matched ${activeRule.field} ${activeRule.operator} ${activeRule.value}.`,
				});
			}

			const choice = await this.#runAiClassification(email);
			const lowConfidenceThreshold = Math.max(
				0,
				Math.min(1, options.lowConfidenceThreshold ?? 0.55),
			);
			if (choice.confidence < lowConfidenceThreshold) {
				console.warn(
					`Low-confidence email classification for ${emailId}: ${choice.labelId} (${choice.confidence})`,
				);
			}
			return this.applyEmailLabel(emailId, choice.labelId, {
				source: "ai",
				confidence: choice.confidence,
				reason: choice.reason,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : "Classification failed";
			console.error("Email classification failed:", emailId, message);
			this.#recordClassificationStatus(emailId, "error", message);
			return this.getClassification(emailId);
		}
	}

	async suggestRuleForEmail(emailId: string, labelId?: string) {
		const email = (await this.getEmail(emailId)) as EmailData | null;
		if (!email) return { error: "Email not found" };

		let targetLabelId = labelId;
		if (!targetLabelId) {
			const current = await this.getClassification(emailId);
			targetLabelId = current.labels[0]?.id;
		}
		if (!targetLabelId) return { error: "No label to build a rule for" };

		const suggestion = buildSuggestedSenderDomainRule(email, targetLabelId);
		if (!suggestion) return { error: "Cannot infer a safe rule" };

		const existing = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM classification_rules
				 WHERE label_id = ?1 AND field = ?2 AND operator = ?3 AND value = ?4
				 ORDER BY updated_at DESC LIMIT 1`,
				suggestion.labelId,
				suggestion.field,
				suggestion.operator,
				suggestion.value,
			),
		][0] as Record<string, unknown> | undefined;
		if (existing) return existing;

		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`INSERT INTO classification_rules
				(id, label_id, field, operator, value, status, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'suggested', ?6, ?6)`,
			id,
			suggestion.labelId,
			suggestion.field,
			suggestion.operator,
			suggestion.value,
			now,
		);
		return [...this.ctx.storage.sql.exec(
			`SELECT * FROM classification_rules WHERE id = ?1`,
			id,
		)][0];
	}

	async correctEmailLabel(emailId: string, labelId: string, reason?: string) {
		const current = await this.getClassification(emailId);
		const fromLabelId = current.labels[0]?.id ?? null;
		const applied = await this.applyEmailLabel(emailId, labelId, {
			source: "manual",
			confidence: 1,
			reason: reason || "Manually corrected by the mailbox owner.",
		});
		if ("error" in applied) return applied;

		this.ctx.storage.sql.exec(
			`INSERT INTO classification_feedback
				(id, email_id, from_label_id, to_label_id, reason, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			crypto.randomUUID(),
			emailId,
			fromLabelId,
			labelId,
			reason ?? null,
			new Date().toISOString(),
		);

		const suggestedRule = await this.suggestRuleForEmail(emailId, labelId);
		console.log(`Classification corrected for ${emailId}: ${fromLabelId} -> ${labelId}`);
		return { ...applied, suggestedRule };
	}

	async getClassificationRules() {
		return [
			...this.ctx.storage.sql.exec(
				`SELECT r.*, l.name as label_name, l.color as label_color
				 FROM classification_rules r
				 JOIN labels l ON l.id = r.label_id
				 ORDER BY r.status = 'suggested' DESC, r.updated_at DESC`,
			),
		];
	}

	async updateClassificationRuleStatus(id: string, status: "active" | "disabled") {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(
			`UPDATE classification_rules
			 SET status = ?2, updated_at = ?3
			 WHERE id = ?1`,
			id,
			status,
			now,
		);
		const row = [...this.ctx.storage.sql.exec(
			`SELECT * FROM classification_rules WHERE id = ?1`,
			id,
		)][0];
		return row ?? { error: "Rule not found" };
	}

	async getEmailsForClassification(options: {
		folder?: string;
		limit?: number;
		page?: number;
		force?: boolean;
	} = {}) {
		const { folder, page = 1, limit: rawLimit = 25, force = false } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const offset = (page - 1) * limit;
		const params: (string | number)[] = [];
		let where = "WHERE e.folder_id NOT IN ('sent', 'draft', 'trash')";
		if (folder) {
			params.push(folder);
			where += ` AND e.folder_id = (SELECT id FROM folders WHERE name = ?${params.length} OR id = ?${params.length} LIMIT 1)`;
		}
		if (!force) {
			where +=
				" AND (ec.status IS NULL OR ec.status != 'classified')";
		}
		const limitParam = params.length + 1;
		const offsetParam = params.length + 2;
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT e.id
				 FROM emails e
				 LEFT JOIN email_classifications ec ON ec.email_id = e.id
				 ${where}
				 ORDER BY e.date DESC
				 LIMIT ?${limitParam} OFFSET ?${offsetParam}`,
				...params,
				limit,
				offset,
			),
		] as { id: string }[];
		return rows.map((row) => row.id);
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			label,
			thread_id,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (label) {
			conditions.push(
				sql`${schema.emails.id} IN (SELECT email_id FROM email_labels WHERE label_id = ${label})`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return this.#decorateEmailsWithLabels(result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
		})));
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; label?: string; thread_id?: string } = {}) {
		const { folder, label, thread_id } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (label) {
			conditions.push(`id IN (SELECT email_id FROM email_labels WHERE label_id = ?${params.length + 1})`);
			params.push(label);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (raw SQL — too complex for Drizzle's builder) ──

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			page = 1,
			limit: rawLimit = 25,
		} = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		if (!folder) {
			// Fallback to regular getEmails if no folder specified
			return this.getEmails(options);
		}

		const offset = (page - 1) * limit;

		// Thread grouping strategy:
		// For DRAFT folder: group by in_reply_to (the email being replied to).
		//   This ensures reply-drafts to different emails stay separate, even if
		//   they share a thread_id or subject. New drafts (no in_reply_to) each
		//   get their own group via their unique id.
		// For other folders:
		//   1. Primary: group by thread_id (from email threading headers)
		//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
		//      for legacy emails that lack threading headers (thread_id IS NULL).
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const result = this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT *,
						COALESCE(in_reply_to, id) as draft_group_key
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				draft_stats AS (
					SELECT
						draft_group_key,
						COUNT(*) as thread_count,
						SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
						GROUP_CONCAT(DISTINCT sender) as participants
					FROM folder_emails
					GROUP BY draft_group_key
				),
				latest_per_group AS (
					SELECT
						fe.*,
						ROW_NUMBER() OVER (
							PARTITION BY fe.draft_group_key
							ORDER BY fe.date DESC
						) as rn
					FROM folder_emails fe
				)
				SELECT
					lp.id, lp.subject, lp.sender, lp.recipient, lp.date,
					lp.read, lp.starred, lp.thread_id, lp.folder_id,
					lp.in_reply_to, lp.email_references,
					SUBSTR(lp.body, 1, 300) as snippet,
					ds.thread_count, ds.thread_unread_count, ds.participants
				FROM latest_per_group lp
				JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
				WHERE lp.rn = 1
				ORDER BY lp.date DESC
				LIMIT ?2 OFFSET ?3`,
				folder, limit, offset
			);

			const rows = [...result];
			return this.#decorateEmailsWithLabels(rows.map((row: any) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
				thread_count: row.thread_count || 1,
				thread_unread_count: row.thread_unread_count || 0,
				participants: row.participants || row.sender,
			})));
		}

		// Non-draft folders: full threading logic
		const result = this.ctx.storage.sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN thread_to_conversation tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					GROUP_CONCAT(DISTINCT sender) as participants,
					SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) as has_draft
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN thread_to_conversation tc
					ON fe.raw_thread_id = tc.raw_thread_id
			)
			SELECT
				lif.id, lif.subject, lif.sender, lif.recipient, lif.date,
				lif.read, lif.starred, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				SUBSTR(lif.body, 1, 300) as snippet,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
					AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			ORDER BY lif.date DESC
			LIMIT ?2 OFFSET ?3`,
			folder, limit, offset
		);

		const rows = [...result];
		return this.#decorateEmailsWithLabels(rows.map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
			needs_reply: !!row.needs_reply,
			has_draft: !!row.has_draft,
		})));
	}

	/**
	 * Count threaded conversations in a folder (for pagination).
	 * Returns the number of conversation groups, not individual emails.
	 */
	async countThreadedEmails(folder: string) {
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
					 FROM emails
					 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
					folder,
				),
			][0] as { total: number } | undefined;
			return row?.total ?? 0;
		}

		const row = [
			...this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT
						COALESCE(thread_id, id) as raw_thread_id,
						thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				thread_to_conversation AS (
					SELECT
						raw_thread_id,
						CASE
							WHEN thread_id IS NOT NULL THEN raw_thread_id
							WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
							ELSE raw_thread_id
						END as conversation_id
					FROM folder_emails
					GROUP BY raw_thread_id, normalized_subject, thread_id
				)
				SELECT COUNT(DISTINCT conversation_id) as total
				FROM thread_to_conversation`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		const labels = await this.#getLabelsForEmailIds([id]);
		const classification = await this.getClassification(id);

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
			labels: labels.get(id) ?? [],
			classification,
		};
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		] as any[];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders})`,
				...emailIds,
			),
		] as any[];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, any[]>();
		for (const att of attachmentRows) {
			const list = attachmentsByEmail.get(att.email_id) || [];
			list.push(att);
			attachmentsByEmail.set(att.email_id, list);
		}

		const labelsByEmail = await this.#getLabelsForEmailIds(emailIds);
		return emailRows.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: attachmentsByEmail.get(email.id) || [],
			labels: labelsByEmail.get(email.id) || [],
		}));
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		this.db
			.delete(schema.emails)
			.where(eq(schema.emails.id, id))
			.run();

		return emailAttachments;
	}

	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.get() ?? null
		);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	async createFolder(id: string, name: string, is_deletable: number = 1) {
		try {
			const result = this.db
				.insert(schema.folders)
				.values({ id, name, is_deletable })
				.returning({ id: schema.folders.id, name: schema.folders.name })
				.get();
			return { ...result, unreadCount: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		const result = this.db
			.update(schema.folders)
			.set({ name })
			.where(eq(schema.folders.id, id))
			.returning({ id: schema.folders.id, name: schema.folders.name })
			.get();
		return result;
	}

	async deleteFolder(id: string) {
		const folder = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();

		if (!folder || folder.is_deletable === 0) {
			return false;
		}

		this.db
			.delete(schema.folders)
			.where(eq(schema.folders.id, id))
			.run();

		return true;
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		return true;
	}

	// ── Search (raw SQL — dynamic condition builder) ───────────────

	/**
	 * Build WHERE conditions and params for search queries.
	 * Shared between searchEmails and countSearchResults.
	 */
	#buildSearchConditions(
		options: SearchFilterOptions,
		tableAlias = "",
	): { conditions: string[]; params: (string | number)[] } {
		const { query, folder, label, from, to, subject, date_start, date_end, is_read, is_starred, has_attachment } = options;
		const prefix = tableAlias ? `${tableAlias}.` : "";
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		let paramIdx = 0;

		const addParam = (value: string | number) => {
			paramIdx++;
			params.push(value);
			return `?${paramIdx}`;
		};

		if (query) {
			const p1 = addParam(`%${query}%`);
			const p2 = addParam(`%${query}%`);
			const p3 = addParam(`%${query}%`);
			const p4 = addParam(`%${query}%`);
			conditions.push(`(${prefix}subject LIKE ${p1} OR ${prefix}body LIKE ${p2} OR ${prefix}sender LIKE ${p3} OR ${prefix}recipient LIKE ${p4} OR ${prefix}cc LIKE ${p4} OR ${prefix}bcc LIKE ${p4})`);
		}
		if (folder) {
			const p = addParam(folder);
			conditions.push(`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${p} OR id = ${p} LIMIT 1)`);
		}
		if (label) {
			const p = addParam(label);
			conditions.push(`${prefix}id IN (SELECT email_id FROM email_labels WHERE label_id = ${p})`);
		}
		if (from) { const p = addParam(`%${from}%`); conditions.push(`${prefix}sender LIKE ${p}`); }
		if (to) { const p = addParam(`%${to}%`); conditions.push(`(${prefix}recipient LIKE ${p} OR ${prefix}cc LIKE ${p} OR ${prefix}bcc LIKE ${p})`); }
		if (subject) { const p = addParam(`%${subject}%`); conditions.push(`${prefix}subject LIKE ${p}`); }
		if (date_start) { const p = addParam(date_start); conditions.push(`${prefix}date >= ${p}`); }
		if (date_end) { const p = addParam(date_end); conditions.push(`${prefix}date <= ${p}`); }
		if (is_read !== undefined) { const p = addParam(is_read ? 1 : 0); conditions.push(`${prefix}read = ${p}`); }
		if (is_starred !== undefined) { const p = addParam(is_starred ? 1 : 0); conditions.push(`${prefix}starred = ${p}`); }
		if (has_attachment) { conditions.push(`${prefix}id IN (SELECT DISTINCT email_id FROM attachments)`); }

		return { conditions, params };
	}

	async searchEmails(options: SearchFilterOptions & { page?: number; limit?: number }) {
		const { page = 1, limit: rawLimit = 25 } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const { conditions, params } = this.#buildSearchConditions(options, "e");

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const offset = (page - 1) * limit;

		const query = `
			SELECT e.id, e.subject, e.sender, e.recipient, e.cc, e.bcc, e.date,
				e.read, e.starred, e.in_reply_to, e.email_references,
				e.thread_id, e.folder_id,
				SUBSTR(e.body, 1, 300) as snippet,
				f.name as folder_name
			FROM emails e
			LEFT JOIN folders f ON e.folder_id = f.id
			${where}
			ORDER BY e.date DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(limit, offset);

		const result = this.ctx.storage.sql.exec(query, ...params);
		return this.#decorateEmailsWithLabels([...result].map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
		})));
	}

	/**
	 * Count total search results matching the given filters (for pagination).
	 */
	async countSearchResults(options: SearchFilterOptions) {
		const { conditions, params } = this.#buildSearchConditions(options);

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const query = `SELECT COUNT(*) as total FROM emails ${where}`;

		const row = [...this.ctx.storage.sql.exec(query, ...params)][0] as
			| { total: number }
			| undefined;
		return row?.total ?? 0;
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		const normalized = subject
			.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
			.trim()
			.toLowerCase();

		if (!normalized) return null;

		const result = this.ctx.storage.sql.exec(
			`SELECT thread_id, subject,
			        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
			        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
			 FROM emails
			 WHERE thread_id IS NOT NULL
			   AND thread_id != id
			   AND date >= datetime('now', '-7 days')
			 GROUP BY thread_id
			 ORDER BY MAX(date) DESC
			 LIMIT 50`,
		);

		const normalizedSender = senderAddress?.toLowerCase().trim();

		for (const row of result) {
			const rowSubject = String((row as any).subject || "")
				.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
				.trim()
				.toLowerCase();
			if (rowSubject !== normalized) continue;

			if (normalizedSender) {
				const threadSenders = String((row as any).senders || "");
				const threadRecipients = String((row as any).recipients || "");
				const allParticipants = `${threadSenders},${threadRecipients}`;
				if (!allParticipants.includes(normalizedSender)) {
					continue;
				}
			}

			return String((row as any).thread_id);
		}
		return null;
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/**
	 * Check if the mailbox has exceeded the send rate limit.
	 * Limits: 20 emails per hour, 100 per day per mailbox.
	 * Returns null if under limit, or an error message string if exceeded.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 hour')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 day')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;

		// Sent emails are always read — the sender obviously knows what they wrote.
		// This prevents sent replies from inflating thread_unread_count.
		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isSent ? 1 : (email.read ? 1 : 0),
				starred: email.starred ? 1 : 0,
				body: email.body,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}
	}
}
