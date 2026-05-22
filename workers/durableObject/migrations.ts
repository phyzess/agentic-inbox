// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Migration {
	name: string;
	sql: string;
}

/**
 * Minimal migration runner that replaces workers-qb's DOQB.migrations().apply().
 *
 * Uses the `d1_migrations` tracking table for backward compatibility with
 * existing deployments that were managed by workers-qb. New deployments
 * create the same table so the schema is consistent either way.
 */
export function applyMigrations(
	sql: SqlStorage,
	migrations: Migration[],
	storage?: DurableObjectStorage,
): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	for (const migration of migrations) {
		const applied = [
			...sql.exec(
				`SELECT 1 FROM d1_migrations WHERE name = ?`,
				migration.name,
			),
		];
		if (applied.length > 0) continue;

		// Strip any existing BEGIN/COMMIT wrapper from the migration SQL.
		// Cloudflare's DO runtime forbids SQL-level transactions -- must use
		// the JS storage.transactionSync() API instead.
		let migrationSql = migration.sql.trim();
		migrationSql = migrationSql.replace(/^\s*BEGIN\s+TRANSACTION\s*;?\s*/i, "");
		migrationSql = migrationSql.replace(/\s*COMMIT\s*;?\s*$/i, "");

		const escapedName = migration.name.replace(/'/g, "''");
		const run = () => {
			sql.exec(migrationSql);
			sql.exec(
				`INSERT INTO d1_migrations (name) VALUES ('${escapedName}')`,
			);
		};

		if (storage) {
			// Preferred: atomic transaction via the DO JS API
			storage.transactionSync(run);
		} else {
			// Fallback: run without explicit transaction (each exec is auto-committed)
			run();
		}
	}
}

interface DurableObjectStorage {
	transactionSync: <T>(closure: () => T) => T;
}

/**
 * Wrap SQL in a transaction so multi-statement migrations are atomic.
 *
 * Without this, a migration like `1_initial_setup` (CREATE + INSERT +
 * CREATE + CREATE) could fail mid-way and leave the database in an
 * inconsistent state that the runner considers "applied" but is
 * actually broken.  SQLite transactions guarantee all-or-nothing.
 *
 * Single-statement migrations don't strictly need it but wrapping
 * uniformly costs nothing and avoids accidental omissions.
 */
function txn(sql: string): string {
	const trimmed = sql.trim();
	// Don't double-wrap if someone already added BEGIN/COMMIT
	if (/^\s*BEGIN\b/i.test(trimmed)) return trimmed;
	return `BEGIN TRANSACTION;\n${trimmed}\nCOMMIT;`;
}

export const mailboxMigrations: Migration[] = [
	{
		name: "1_initial_setup",
		sql: txn(`
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                is_deletable INTEGER NOT NULL DEFAULT 1
            );

            INSERT INTO folders (id, name, is_deletable) VALUES
                ('inbox', 'Inbox', 0),
                ('sent', 'Sent', 0),
                ('trash', 'Trash', 0),
                ('archive', 'Archive', 0),
                ('spam', 'Spam', 0);

            CREATE TABLE emails (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                subject TEXT,
                sender TEXT,
                recipient TEXT,
                date TEXT,
                read INTEGER DEFAULT 0,
                starred INTEGER DEFAULT 0,
                body TEXT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_id TEXT,
                disposition TEXT,
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
            );
        `),
	},
	{
		name: "2_add_email_threading",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
            ALTER TABLE emails ADD COLUMN email_references TEXT;
            ALTER TABLE emails ADD COLUMN thread_id TEXT;

            CREATE INDEX idx_emails_thread_id ON emails(thread_id);
            CREATE INDEX idx_emails_in_reply_to ON emails(in_reply_to);
        `),
	},
	{
		name: "3_add_draft_folder",
		sql: txn(`INSERT INTO folders (id, name, is_deletable) VALUES ('draft', 'Drafts', 0);`),
	},
	{
		name: "4_add_message_id",
		sql: txn(`ALTER TABLE emails ADD COLUMN message_id TEXT;`),
	},
	{
		name: "5_add_raw_headers",
		sql: txn(`ALTER TABLE emails ADD COLUMN raw_headers TEXT;`),
	},
	{
		name: "6_mark_sent_emails_as_read",
		sql: txn(`UPDATE emails SET read = 1 WHERE folder_id = 'sent' AND read = 0;`),
	},
	{
		name: "7_add_cc_bcc",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN cc TEXT;
            ALTER TABLE emails ADD COLUMN bcc TEXT;
        `),
	},
	{
		// No txn() wrapper: Cloudflare's DO runtime requires state.storage.transactionSync()
		// instead of SQL-level BEGIN TRANSACTION. These are idempotent CREATE INDEX IF NOT EXISTS
		// statements so they're safe to run without a transaction.
		name: "8_add_folder_date_indexes",
		sql: `
            CREATE INDEX IF NOT EXISTS idx_emails_folder_id ON emails(folder_id);
            CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
            CREATE INDEX IF NOT EXISTS idx_emails_folder_date ON emails(folder_id, date DESC);
		`,
	},
	{
		name: "9_add_ai_triage_labels",
		sql: `
			CREATE TABLE IF NOT EXISTS labels (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				description TEXT,
				color TEXT,
				is_system INTEGER NOT NULL DEFAULT 1
			);

			INSERT OR IGNORE INTO labels (id, name, description, color, is_system) VALUES
				('action_needed', 'Action needed', 'Needs a reply, decision, or concrete follow-up.', '#dc2626', 1),
				('waiting', 'Waiting', 'You are waiting for someone else to respond or act.', '#d97706', 1),
				('newsletter', 'Newsletter', 'Recurring editorial, digest, marketing, or list email.', '#2563eb', 1),
				('notification', 'Notification', 'Automated product, account, or workflow notification.', '#4f46e5', 1),
				('transaction', 'Transaction', 'Receipt, invoice, shipping, payment, or account transaction.', '#059669', 1),
				('personal', 'Personal', 'Human personal or relationship-oriented message.', '#be185d', 1),
				('low_priority', 'Low priority', 'Safe to read later; low urgency and low consequence.', '#64748b', 1);

			CREATE TABLE IF NOT EXISTS email_labels (
				email_id TEXT NOT NULL,
				label_id TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'ai',
				confidence REAL,
				reason TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				PRIMARY KEY (email_id, label_id),
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
				FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS email_classifications (
				email_id TEXT PRIMARY KEY,
				status TEXT NOT NULL DEFAULT 'unclassified',
				error TEXT,
				classified_at TEXT,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS classification_feedback (
				id TEXT PRIMARY KEY,
				email_id TEXT NOT NULL,
				from_label_id TEXT,
				to_label_id TEXT NOT NULL,
				reason TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
				FOREIGN KEY(from_label_id) REFERENCES labels(id) ON DELETE SET NULL,
				FOREIGN KEY(to_label_id) REFERENCES labels(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS classification_rules (
				id TEXT PRIMARY KEY,
				label_id TEXT NOT NULL,
				field TEXT NOT NULL,
				operator TEXT NOT NULL,
				value TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'suggested',
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_email_labels_label_id ON email_labels(label_id);
			CREATE INDEX IF NOT EXISTS idx_email_labels_email_id ON email_labels(email_id);
			CREATE INDEX IF NOT EXISTS idx_classification_rules_status ON classification_rules(status);
			CREATE INDEX IF NOT EXISTS idx_classification_feedback_email_id ON classification_feedback(email_id);
		`,
	},
	{
		name: "10_add_triage_events",
		sql: `
			CREATE TABLE IF NOT EXISTS triage_events (
				id TEXT PRIMARY KEY,
				email_id TEXT NOT NULL,
				action TEXT NOT NULL,
				source TEXT NOT NULL,
				label_id TEXT,
				from_folder_id TEXT,
				to_folder_id TEXT,
				created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				undone_at TEXT,
				FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
				FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE SET NULL,
				FOREIGN KEY(from_folder_id) REFERENCES folders(id) ON DELETE SET NULL,
				FOREIGN KEY(to_folder_id) REFERENCES folders(id) ON DELETE SET NULL
			);

			CREATE INDEX IF NOT EXISTS idx_triage_events_created_at ON triage_events(created_at);
			CREATE INDEX IF NOT EXISTS idx_triage_events_email_id ON triage_events(email_id);
		`,
	},
];
