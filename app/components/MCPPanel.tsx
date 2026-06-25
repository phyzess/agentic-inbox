// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	CheckIcon,
	CopyIcon,
	PlugsIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API unavailable or permission denied — ignore silently
		}
	};

	return (
		<Tooltip content={copied ? "Copied!" : "Copy"} asChild>
			<Button
				variant="ghost"
				shape="square"
				size="sm"
				icon={
					copied ? (
						<CheckIcon size={12} weight="bold" className="text-kumo-success" />
					) : (
						<CopyIcon size={12} />
					)
				}
				onClick={handleCopy}
				aria-label="Copy to clipboard"
			/>
		</Tooltip>
	);
}

const TOOLS = [
	{ name: "list_mailboxes", desc: "List all mailboxes" },
	{ name: "list_labels", desc: "List smart labels" },
	{ name: "list_emails", desc: "List emails in a folder" },
	{ name: "get_email", desc: "Read a full email with body" },
	{ name: "get_thread", desc: "Load a conversation thread" },
	{ name: "search_emails", desc: "Search emails by query" },
	{ name: "classify_email", desc: "Classify an email" },
	{ name: "apply_label", desc: "Correct a smart label" },
	{ name: "clear_label", desc: "Clear a smart label" },
	{ name: "explain_classification", desc: "Explain a label" },
	{ name: "suggest_rule", desc: "Suggest a rule" },
	{ name: "draft_reply", desc: "Draft a reply to an email" },
	{ name: "send_reply", desc: "Send a reply" },
	{ name: "send_email", desc: "Send a new email" },
	{ name: "mark_email_read", desc: "Mark email as read/unread" },
	{ name: "move_email", desc: "Move email to a folder" },
	{ name: "delete_email", desc: "Permanently delete an email" },
];

export default function MCPPanel() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const baseUrl =
		typeof window !== "undefined" ? window.location.origin : "https://your-app.workers.dev";
	const mcpUrl = `${baseUrl}/mcp`;
	const clientConfig = JSON.stringify(
		{
			mcpServers: {
				"agentic-inbox": {
					url: mcpUrl,
				},
			},
		},
		null,
		2,
	);

	return (
		<div className="flex h-full flex-col bg-kumo-base">
			{/* Content */}
			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
				{/* Intro */}
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="sketch-bubble flex h-10 w-10 items-center justify-center">
							<PlugsIcon
								size={20}
								weight="duotone"
								className="text-kumo-brand"
							/>
						</div>
						<div>
							<h3 className="text-sm font-bold text-kumo-default">
								Connect via MCP
							</h3>
							<p className="text-xs text-kumo-subtle">
								Model Context Protocol
							</p>
						</div>
					</div>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						This email agent exposes an MCP server so AI coding
						assistants can manage your inbox directly — read emails,
						search, draft replies, and send messages using natural
						language.
					</p>
				</div>

				{/* MCP URL */}
				<div className="space-y-1.5">
					<label className="swiss-label block">
						Server URL
					</label>
					<div className="relative group">
						<div className="absolute right-1.5 top-1/2 -translate-y-1/2">
							<CopyButton text={mcpUrl} />
						</div>
						<div className="break-all rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2.5 pr-10 font-mono text-[11px] leading-relaxed text-kumo-default">
							{mcpUrl}
						</div>
					</div>
				</div>

				{/* Client config */}
				<div className="space-y-1.5">
					<div className="flex items-center justify-between">
						<label className="swiss-label block">
							Client config
						</label>
						<CopyButton text={clientConfig} />
					</div>
					<pre className="max-h-36 overflow-auto rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2 text-[11px] leading-relaxed text-kumo-default">
						{clientConfig}
					</pre>
				</div>

				{/* Scope */}
				<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2.5">
					<div className="text-xs font-semibold text-kumo-default">
						Permission scope
					</div>
					<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
						Connected clients use the same Cloudflare Access policy as this app. The current mailbox is {mailboxId}, but MCP tools accept a mailboxId parameter and can operate on any mailbox allowed by this deployment.
					</p>
				</div>

				{/* Available tools */}
				<div className="space-y-2">
					<h4 className="swiss-label px-0.5">
						Available Tools
					</h4>
					<div className="surface-card divide-y divide-kumo-line">
						{TOOLS.map((tool) => (
							<div
								key={tool.name}
								className="flex items-center gap-2.5 px-3 py-2"
							>
								<WrenchIcon
									size={12}
									weight="bold"
									className="text-kumo-brand shrink-0"
								/>
								<div className="min-w-0 flex-1">
									<span className="text-xs font-mono font-medium text-kumo-default">
										{tool.name}
									</span>
								</div>
								<span className="text-[11px] text-kumo-subtle shrink-0">
									{tool.desc}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
