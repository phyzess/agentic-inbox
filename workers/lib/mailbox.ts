// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks if the mailbox exists in R2, then instantiates the DO stub
 * and attaches it to the Hono context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import {
	canAccessMailbox,
	getAccessContextFromRequest,
	type AccessContext,
} from "./access";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxStub: DurableObjectStub<MailboxDO>;
		mailboxSettings: Record<string, unknown>;
		access: AccessContext;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = decodeURIComponent(rawId);

	// Verify mailbox exists
	const key = `mailboxes/${mailboxId}.json`;
	const obj = await c.env.BUCKET.get(key);
	if (!obj) {
		return c.json({ error: "Not found" }, 404);
	}
	const settings = await obj.json<Record<string, unknown>>();
	const access = getAccessContextFromRequest(c.req.raw);
	if (!canAccessMailbox(settings, access)) {
		return c.json({ error: "Mailbox access denied" }, 403);
	}

	// Instantiate DO stub
	const ns = c.env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	const stub = ns.get(id);

	c.set("mailboxStub", stub);
	c.set("mailboxSettings", settings);
	c.set("access", access);

	await next();
});
