// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	sqliteTable,
	text,
	integer,
	real,
	primaryKey,
} from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	folder_id: text("folder_id")
		.notNull()
		.references(() => folders.id, { onDelete: "cascade" }),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	mimetype: text("mimetype").notNull(),
	size: integer("size").notNull(),
	content_id: text("content_id"),
	disposition: text("disposition"),
});

export const labels = sqliteTable("labels", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	description: text("description"),
	color: text("color"),
	is_system: integer("is_system").notNull().default(1),
});

export const emailLabels = sqliteTable(
	"email_labels",
	{
		email_id: text("email_id")
			.notNull()
			.references(() => emails.id, { onDelete: "cascade" }),
		label_id: text("label_id")
			.notNull()
			.references(() => labels.id, { onDelete: "cascade" }),
		source: text("source").notNull().default("ai"),
		confidence: real("confidence"),
		reason: text("reason"),
		created_at: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
		updated_at: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.email_id, table.label_id] }),
	}),
);

export const emailClassifications = sqliteTable("email_classifications", {
	email_id: text("email_id")
		.primaryKey()
		.references(() => emails.id, { onDelete: "cascade" }),
	status: text("status").notNull().default("unclassified"),
	error: text("error"),
	classified_at: text("classified_at"),
	updated_at: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const classificationFeedback = sqliteTable("classification_feedback", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	from_label_id: text("from_label_id").references(() => labels.id, {
		onDelete: "set null",
	}),
	to_label_id: text("to_label_id")
		.notNull()
		.references(() => labels.id, { onDelete: "cascade" }),
	reason: text("reason"),
	created_at: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const classificationRules = sqliteTable("classification_rules", {
	id: text("id").primaryKey(),
	label_id: text("label_id")
		.notNull()
		.references(() => labels.id, { onDelete: "cascade" }),
	field: text("field").notNull(),
	operator: text("operator").notNull(),
	value: text("value").notNull(),
	status: text("status").notNull().default("suggested"),
	created_at: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
	updated_at: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
});

export const triageEvents = sqliteTable("triage_events", {
	id: text("id").primaryKey(),
	email_id: text("email_id")
		.notNull()
		.references(() => emails.id, { onDelete: "cascade" }),
	action: text("action").notNull(),
	source: text("source").notNull(),
	label_id: text("label_id").references(() => labels.id, {
		onDelete: "set null",
	}),
	from_folder_id: text("from_folder_id").references(() => folders.id, {
		onDelete: "set null",
	}),
	to_folder_id: text("to_folder_id").references(() => folders.id, {
		onDelete: "set null",
	}),
	created_at: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
	undone_at: text("undone_at"),
});
