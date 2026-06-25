// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { decodeJwt } from "jose";

export interface AccessContext {
	userEmail: string | null;
	isLocalBypass: boolean;
}

export type McpScope = "read" | "organize" | "draft" | "send" | "delete";

export interface MailboxSecuritySettings {
	allowedAccessEmails?: string[];
	mcpScopes?: Partial<Record<McpScope, boolean>>;
}

const DEFAULT_MCP_SCOPES: Record<McpScope, boolean> = {
	read: true,
	organize: true,
	draft: true,
	send: true,
	delete: true,
};

function normalizeEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const email = value.trim().toLowerCase();
	return email.includes("@") ? email : null;
}

export function normalizeAllowedAccessEmails(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const emails = value
		.map((item) => normalizeEmail(item))
		.filter((item): item is string => Boolean(item));
	return [...new Set(emails)];
}

export function getAccessContextFromRequest(request: Request): AccessContext {
	const url = new URL(request.url);
	const isLocalBypass =
		import.meta.env.DEV ||
		url.hostname === "localhost" ||
		url.hostname === "127.0.0.1" ||
		url.hostname === "::1";

	const token = request.headers.get("cf-access-jwt-assertion");
	if (token) {
		try {
			const payload = decodeJwt(token) as { email?: unknown };
			const tokenEmail = normalizeEmail(payload.email);
			if (tokenEmail) {
				return { userEmail: tokenEmail, isLocalBypass };
			}
		} catch {
			return { userEmail: null, isLocalBypass };
		}
	}

	const headerEmail = normalizeEmail(
		request.headers.get("cf-access-authenticated-user-email"),
	);
	return { userEmail: headerEmail, isLocalBypass };
}

export function securitySettings(
	settings: Record<string, unknown>,
): Required<MailboxSecuritySettings> {
	const raw = (settings.security ?? {}) as MailboxSecuritySettings;
	const rawScopes =
		raw.mcpScopes && typeof raw.mcpScopes === "object"
			? raw.mcpScopes
			: {};
	return {
		allowedAccessEmails: normalizeAllowedAccessEmails(raw.allowedAccessEmails),
		mcpScopes: {
			...DEFAULT_MCP_SCOPES,
			read: rawScopes.read !== false,
			organize: rawScopes.organize !== false,
			draft: rawScopes.draft !== false,
			send: rawScopes.send !== false,
			delete: rawScopes.delete !== false,
		},
	};
}

export function canAccessMailbox(
	settings: Record<string, unknown>,
	access: AccessContext,
) {
	const security = securitySettings(settings);
	if (security.allowedAccessEmails.length === 0) return true;
	if (access.isLocalBypass) return true;
	if (!access.userEmail) return false;
	return security.allowedAccessEmails.includes(access.userEmail);
}

export function canUseMcpScope(
	settings: Record<string, unknown>,
	scope: McpScope,
) {
	return securitySettings(settings).mcpScopes[scope];
}
