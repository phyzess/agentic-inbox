// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { RobotIcon, ArrowCounterClockwiseIcon, PlugsIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useState } from "react";
import { useParams } from "react-router";
import { DEFAULT_AUTO_FILE_LABEL_IDS, DEFAULT_SMART_LABELS } from "shared/labels";
import api from "~/services/api";
import {
	useBackfillTriage,
	useBulkFileLabel,
	useBulkMarkLabelRead,
	useConfirmRule,
	useDisableRule,
	useLabels,
	useRules,
	useTriageActivity,
	useTriageStatus,
	useUndoTriageActivity,
} from "~/queries/labels";
import { queryKeys } from "~/queries/keys";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import type { McpScope } from "~/types";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

const MCP_SCOPE_OPTIONS: Array<{
	id: McpScope;
	label: string;
	description: string;
}> = [
	{
		id: "read",
		label: "Read",
		description: "List, search, and read mailbox content.",
	},
	{
		id: "organize",
		label: "Organize",
		description: "Classify, label, move, and mark mail read.",
	},
	{
		id: "draft",
		label: "Draft",
		description: "Create and update draft messages.",
	},
	{
		id: "send",
		label: "Send",
		description: "Send new emails and replies.",
	},
	{
		id: "delete",
		label: "Delete",
		description: "Permanently delete messages.",
	},
];

const DEFAULT_MCP_SCOPES: Record<McpScope, boolean> = {
	read: true,
	organize: true,
	draft: true,
	send: true,
	delete: true,
};

function formatActivityDate(value?: string | null) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString();
}

function humanizeEventSource(source: string) {
	return source.replaceAll("_", " ");
}

function formatAccessEmails(emails?: string[]) {
	return (emails ?? []).join("\n");
}

function parseAccessEmails(value: string) {
	return [
		...new Set(
			value
				.split(/[\n,;]/)
				.map((item) => item.trim().toLowerCase())
				.filter((item) => item.includes("@")),
		),
	];
}

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: accessIdentity } = useQuery({
		queryKey: queryKeys.accessIdentity,
		queryFn: () => api.getAccessIdentity(),
		staleTime: 60_000,
	});
	const updateMailboxMutation = useUpdateMailbox();
	const backfillTriage = useBackfillTriage();
	const confirmRule = useConfirmRule();
	const disableRule = useDisableRule();
	const bulkFileLabel = useBulkFileLabel();
	const bulkMarkLabelRead = useBulkMarkLabelRead();
	const undoTriageActivity = useUndoTriageActivity();
	const { data: labels = [] } = useLabels(mailboxId);
	const { data: rules = [] } = useRules(mailboxId);
	const { data: activity = [] } = useTriageActivity(mailboxId);
	const {
		data: triageStatus,
		refetch: refetchTriageStatus,
	} = useTriageStatus(mailboxId);

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [allowedAccessEmailsText, setAllowedAccessEmailsText] = useState("");
	const [mcpScopes, setMcpScopes] = useState<Record<McpScope, boolean>>({
		...DEFAULT_MCP_SCOPES,
	});
	const [classificationEnabled, setClassificationEnabled] = useState(true);
	const [autoDraftAfterClassify, setAutoDraftAfterClassify] = useState(false);
	const [autoFileAfterClassify, setAutoFileAfterClassify] = useState(false);
	const [autoFileLabels, setAutoFileLabels] = useState<string[]>([
		...DEFAULT_AUTO_FILE_LABEL_IDS,
	]);
	const [bulkLabelId, setBulkLabelId] = useState<string>(
		DEFAULT_AUTO_FILE_LABEL_IDS[0] ?? "notification",
	);
	const [lowConfidenceThreshold, setLowConfidenceThreshold] = useState(0.55);
	const [isSaving, setIsSaving] = useState(false);
	const [isSendingTest, setIsSendingTest] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
			setAllowedAccessEmailsText(
				formatAccessEmails(mailbox.settings?.security?.allowedAccessEmails),
			);
			setMcpScopes({
				...DEFAULT_MCP_SCOPES,
				...(mailbox.settings?.security?.mcpScopes ?? {}),
			});
			setClassificationEnabled(mailbox.settings?.classification?.enabled !== false);
			setAutoDraftAfterClassify(
				mailbox.settings?.classification?.autoDraftAfterClassify === true,
			);
			setAutoFileAfterClassify(
				mailbox.settings?.classification?.autoFileAfterClassify === true,
			);
			const savedAutoFileLabels =
				mailbox.settings?.classification?.autoFileLabels;
			setAutoFileLabels(
				savedAutoFileLabels?.length
					? savedAutoFileLabels
					: [...DEFAULT_AUTO_FILE_LABEL_IDS],
			);
			setLowConfidenceThreshold(
				mailbox.settings?.classification?.lowConfidenceThreshold ?? 0.55,
			);
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
			security: {
				...mailbox.settings?.security,
				allowedAccessEmails: parseAccessEmails(allowedAccessEmailsText),
				mcpScopes,
			},
			classification: {
				enabled: classificationEnabled,
				autoDraftAfterClassify,
				autoFileAfterClassify,
				autoFileLabels,
				lowConfidenceThreshold,
			},
		};
		try {
			await updateMailboxMutation.mutateAsync({ mailboxId, settings });
			toastManager.add({ title: "Settings saved!" });
		} catch {
			toastManager.add({
				title: "Failed to save settings",
				variant: "error",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => {
		setAgentPrompt("");
	};

	const handleSendTestEmail = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSendingTest(true);
		const now = new Date().toISOString();
		try {
			await api.sendEmail(mailboxId, {
				to: mailbox.email,
				from: mailbox.email,
				subject: `Agentic Inbox test ${now}`,
				html: `<p>This is a self-test email from Agentic Inbox.</p><p>Sent at ${now}.</p>`,
				text: `This is a self-test email from Agentic Inbox.\n\nSent at ${now}.`,
			});
			toastManager.add({
				title: "Test email queued",
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Failed to send test email";
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsSendingTest(false);
		}
	};

	const handleExportMailbox = async () => {
		if (!mailbox || !mailboxId) return;
		setIsExporting(true);
		try {
			const blob = await api.exportMailbox(mailboxId);
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${mailbox.email.replace(/[^a-z0-9_.-]/gi, "_")}-export.json`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
			toastManager.add({ title: "Mailbox export downloaded" });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Failed to export mailbox";
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsExporting(false);
		}
	};

	const refreshMailboxData = async () => {
		if (!mailboxId) return;
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: queryKeys.mailboxes.detail(mailboxId),
			}),
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] }),
			queryClient.invalidateQueries({ queryKey: ["search", mailboxId] }),
			queryClient.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			}),
			queryClient.invalidateQueries({
				queryKey: queryKeys.labels.list(mailboxId),
			}),
			queryClient.invalidateQueries({
				queryKey: queryKeys.rules.list(mailboxId),
			}),
			queryClient.invalidateQueries({
				queryKey: queryKeys.triage.status(mailboxId),
			}),
			queryClient.invalidateQueries({
				queryKey: queryKeys.triage.activity(mailboxId),
			}),
		]);
	};

	const handleImportMailbox = async (event: ChangeEvent<HTMLInputElement>) => {
		if (!mailboxId) return;
		const file = event.target.files?.[0];
		if (!file) return;
		setIsImporting(true);
		try {
			const parsed = JSON.parse(await file.text()) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Import file must be a JSON object");
			}
			const result = await api.importMailbox(
				mailboxId,
				parsed as Record<string, unknown>,
				importMode,
			);
			await refreshMailboxData();
			toastManager.add({
				title: `Imported ${result.importedEmails} emails`,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Failed to import mailbox";
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsImporting(false);
			event.target.value = "";
		}
	};

	const triageStatusCards = [
		{ label: "Total", value: triageStatus?.total },
		{ label: "Classified", value: triageStatus?.classified },
		{ label: "Processing", value: triageStatus?.processing },
		{ label: "Failed", value: triageStatus?.error },
		{ label: "Unclassified", value: triageStatus?.unclassified },
	];
	const autoFileChoices = labels.length > 0
		? labels.filter((label) => label.isSystem)
		: [...DEFAULT_SMART_LABELS];
	const selectedBulkLabelId = autoFileChoices.some((label) => label.id === bulkLabelId)
		? bulkLabelId
		: autoFileChoices[0]?.id ?? "";
	const selectedBulkLabel = autoFileChoices.find((label) => label.id === selectedBulkLabelId);
	const visibleRules = rules.slice(0, 8);
	const recentActivity = activity.slice(0, 10);
	const triageTotal = triageStatus?.total ?? 0;
	const triageClassified = triageStatus?.classified ?? 0;
	const triageProcessing = triageStatus?.processing ?? 0;
	const triageError = triageStatus?.error ?? 0;
	const triageUnclassified = triageStatus?.unclassified ?? 0;
	const classificationRate = triageTotal > 0
		? Math.round((triageClassified / triageTotal) * 100)
		: 0;
	const allowedAccessCount = parseAccessEmails(allowedAccessEmailsText).length;
	const activeRuleCount = rules.filter((rule) => rule.status === "active").length;
	const enabledMcpScopeLabels = MCP_SCOPE_OPTIONS
		.filter((scope) => mcpScopes[scope.id])
		.map((scope) => scope.label);
	const healthState = triageError > 0
		? "Needs attention"
		: triageProcessing > 0
			? "Processing"
			: triageUnclassified > 0
				? "Backlog"
				: "Ready";
	const healthCards = [
		{
			label: "Classification",
			value: triageTotal > 0 ? `${classificationRate}%` : "-",
			detail: `${triageUnclassified} unclassified · ${triageError} failed`,
		},
		{
			label: "Automation",
			value: String(activeRuleCount),
			detail: `${rules.length} total rules · ${activity.length} recent actions`,
		},
		{
			label: "Access",
			value: allowedAccessCount > 0 ? "Restricted" : "Access-wide",
			detail: allowedAccessCount > 0
				? `${allowedAccessCount} allowed users`
				: "Any authenticated Access user",
		},
		{
			label: "Agent MCP",
			value: `${enabledMcpScopeLabels.length}/5`,
			detail: enabledMcpScopeLabels.length > 0
				? enabledMcpScopeLabels.join(", ")
				: "No scopes enabled",
		},
	];

	const toggleAutoFileLabel = (labelId: string) => {
		setAutoFileLabels((current) =>
			current.includes(labelId)
				? current.filter((id) => id !== labelId)
				: [...current, labelId],
		);
	};

	const handleConfirmRule = async (ruleId: string) => {
		if (!mailboxId) return;
		try {
			await confirmRule.mutateAsync({ mailboxId, ruleId });
			toastManager.add({ title: "Rule confirmed" });
		} catch {
			toastManager.add({ title: "Failed to confirm rule", variant: "error" });
		}
	};

	const handleDisableRule = async (ruleId: string) => {
		if (!mailboxId) return;
		try {
			await disableRule.mutateAsync({ mailboxId, ruleId });
			toastManager.add({ title: "Rule disabled" });
		} catch {
			toastManager.add({ title: "Failed to disable rule", variant: "error" });
		}
	};

	const handleBulkFile = async () => {
		if (!mailboxId || !selectedBulkLabelId) return;
		try {
			const result = await bulkFileLabel.mutateAsync({
				mailboxId,
				labelId: selectedBulkLabelId,
				limit: 100,
			});
			toastManager.add({
				title: `Moved ${result.moved} ${selectedBulkLabel?.name ?? "labeled"} emails`,
			});
		} catch {
			toastManager.add({ title: "Failed to move labeled emails", variant: "error" });
		}
	};

	const handleBulkMarkRead = async () => {
		if (!mailboxId || !selectedBulkLabelId) return;
		try {
			const result = await bulkMarkLabelRead.mutateAsync({
				mailboxId,
				labelId: selectedBulkLabelId,
				limit: 100,
			});
			toastManager.add({
				title: `Marked ${result.markedRead} ${selectedBulkLabel?.name ?? "labeled"} emails read`,
			});
		} catch {
			toastManager.add({ title: "Failed to mark emails read", variant: "error" });
		}
	};

	const handleUndoActivity = async (eventId: string) => {
		if (!mailboxId) return;
		try {
			await undoTriageActivity.mutateAsync({ mailboxId, eventId });
			toastManager.add({ title: "Move undone" });
		} catch {
			toastManager.add({ title: "Failed to undo move", variant: "error" });
		}
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;

	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

			<div className="space-y-6">
				{/* Health */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<div className="text-sm font-medium text-kumo-default">
								Mailbox health
							</div>
							<div className="mt-1 text-xs text-kumo-subtle">
								{mailbox.email}
							</div>
						</div>
						<Badge variant={healthState === "Ready" ? "primary" : "secondary"}>
							{healthState}
						</Badge>
					</div>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{healthCards.map((card) => (
							<div
								key={card.label}
								className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2"
							>
								<div className="text-[11px] font-medium uppercase text-kumo-subtle">
									{card.label}
								</div>
								<div className="mt-1 text-lg font-semibold text-kumo-default">
									{card.value}
								</div>
								<div className="mt-1 truncate text-xs text-kumo-subtle">
									{card.detail}
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Account */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Account
					</div>
					<div className="space-y-3">
						<Input
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<Input label="Email" type="email" value={mailbox.email} disabled />
					</div>
				</div>

				{/* Security */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="mb-4 flex items-center gap-2">
						<ShieldCheckIcon size={16} weight="duotone" className="text-kumo-subtle" />
						<span className="text-sm font-medium text-kumo-default">
							Access and agent permissions
						</span>
					</div>
					<div className="space-y-3 text-sm text-kumo-strong">
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								Cloudflare Access is the outer trust boundary
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								Current user: {accessIdentity?.email ?? (accessIdentity?.isLocalAccess ? "local development" : "unknown")}.
							</p>
						</div>
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-kumo-subtle">
								Allowed Access users
							</span>
							{accessIdentity?.email && (
								<Button
									variant="ghost"
									size="xs"
									className="mb-2"
									onClick={() => {
										const emails = parseAccessEmails(allowedAccessEmailsText);
										if (!emails.includes(accessIdentity.email!)) {
											setAllowedAccessEmailsText(
												[...emails, accessIdentity.email!].join("\n"),
											);
										}
									}}
								>
									Add current user
								</Button>
							)}
							<textarea
								value={allowedAccessEmailsText}
								onChange={(event) => setAllowedAccessEmailsText(event.target.value)}
								placeholder="Leave empty to allow every user who passes Cloudflare Access"
								rows={4}
								className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring"
							/>
							<span className="mt-1 block text-xs leading-relaxed text-kumo-subtle">
								Add one email per line or comma-separated. When set, this mailbox disappears from other Access users and API/MCP calls are denied.
							</span>
						</label>
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="flex items-center gap-2 font-medium text-kumo-default">
								<PlugsIcon size={14} />
								MCP follows this mailbox allowlist
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								External AI tools connected to /mcp can only operate on this mailbox when the connected Access user is allowed here.
							</p>
						</div>
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								MCP tool permissions
							</div>
							<div className="mt-3 grid gap-2 sm:grid-cols-2">
								{MCP_SCOPE_OPTIONS.map((scope) => (
									<label
										key={scope.id}
										className="flex gap-2 rounded-md border border-kumo-line bg-kumo-base px-3 py-2"
									>
										<input
											type="checkbox"
											checked={mcpScopes[scope.id]}
											onChange={(event) =>
												setMcpScopes((current) => ({
													...current,
													[scope.id]: event.target.checked,
												}))
											}
										/>
										<span className="min-w-0">
											<span className="block text-sm font-medium text-kumo-default">
												{scope.label}
											</span>
											<span className="block text-xs leading-snug text-kumo-subtle">
												{scope.description}
											</span>
										</span>
									</label>
								))}
							</div>
						</div>
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								Sending still requires an explicit action
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								Auto-drafting creates drafts only. Review drafts before sending, and use the activity log below to undo recorded auto-file moves.
							</p>
						</div>
					</div>
				</div>

				{/* Diagnostics */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Diagnostics and data
					</div>
					<div className="space-y-3">
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								Send and receive self-test
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								Sends a test email from this mailbox to itself. If Email Routing is forwarding to this Worker, it should appear in Inbox after delivery.
							</p>
							<Button
								variant="secondary"
								size="sm"
								className="mt-3"
								onClick={() => void handleSendTestEmail()}
								loading={isSendingTest}
							>
								Send test email
							</Button>
						</div>
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								Mailbox export
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								Downloads mailbox settings, folders, emails, labels, rules, and activity as JSON. Attachment metadata is included; attachment file bytes stay in R2.
							</p>
							<Button
								variant="secondary"
								size="sm"
								className="mt-3"
								onClick={() => void handleExportMailbox()}
								loading={isExporting}
							>
								Export JSON
							</Button>
						</div>
						<div className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="font-medium text-kumo-default">
								Mailbox import
							</div>
							<p className="mt-1 text-xs leading-relaxed text-kumo-subtle">
								Restores JSON exports while keeping current Access and MCP security settings. Attachment files already stored in R2 are not recreated from JSON.
							</p>
							<label className="mt-3 flex items-center gap-2 text-xs text-kumo-default">
								<input
									type="checkbox"
									checked={importMode === "replace"}
									onChange={(event) =>
										setImportMode(event.target.checked ? "replace" : "merge")
									}
									className="h-4 w-4 rounded border-kumo-line"
									disabled={isImporting}
								/>
								Replace existing mailbox data first
							</label>
							<Input
								type="file"
								accept="application/json,.json"
								className="mt-3"
								disabled={isImporting}
								onChange={handleImportMailbox}
							/>
							{isImporting && (
								<div className="mt-2 flex items-center gap-2 text-xs text-kumo-subtle">
									<Loader size="sm" />
									Importing mailbox data...
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Agent System Prompt */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								AI Agent Prompt
							</span>
							{isCustomPrompt ? (
								<Badge variant="primary">Custom</Badge>
							) : (
								<Badge variant="secondary">Default</Badge>
							)}
						</div>
						{isCustomPrompt && (
							<Button
								variant="ghost"
								size="xs"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetPrompt}
							>
								Reset to default
							</Button>
						)}
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Customize how the AI agent behaves for this mailbox.
						Leave empty to use the built-in default prompt.
					</p>
					<textarea
						value={agentPrompt}
						onChange={(e) => setAgentPrompt(e.target.value)}
						placeholder={PROMPT_PLACEHOLDER}
						rows={12}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
					/>
					<p className="text-xs text-kumo-subtle mt-2">
						The prompt is sent as the system message to the AI model.
						It controls the agent's personality, writing style, and behavior rules.
					</p>
				</div>

				{/* Smart classification */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Smart Classification
					</div>
					<div className="space-y-3">
						<label className="flex items-center gap-2 text-sm text-kumo-default">
							<input
								type="checkbox"
								checked={classificationEnabled}
								onChange={(event) => setClassificationEnabled(event.target.checked)}
							/>
							Classify new inbound emails
						</label>
						<label className="flex items-center gap-2 text-sm text-kumo-default">
							<input
								type="checkbox"
								checked={autoDraftAfterClassify}
								onChange={(event) =>
									setAutoDraftAfterClassify(event.target.checked)
								}
							/>
							Auto-draft replies after classification
						</label>
						<label className="flex items-center gap-2 text-sm text-kumo-default">
							<input
								type="checkbox"
								checked={autoFileAfterClassify}
								onChange={(event) =>
									setAutoFileAfterClassify(event.target.checked)
								}
							/>
							Move selected labels to folders
						</label>
						{autoFileAfterClassify && (
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
								{autoFileChoices.map((label) => (
									<label
										key={label.id}
										className="flex items-center gap-2 rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default"
									>
										<input
											type="checkbox"
											checked={autoFileLabels.includes(label.id)}
											onChange={() => toggleAutoFileLabel(label.id)}
										/>
										<span className="truncate">{label.name}</span>
									</label>
								))}
							</div>
						)}
						<label className="block text-sm text-kumo-default">
							<span className="mb-1 block text-xs font-medium text-kumo-subtle">
								Low-confidence threshold
							</span>
							<input
								type="number"
								min="0"
								max="1"
								step="0.05"
								value={lowConfidenceThreshold}
								onChange={(event) => {
									const next = Number(event.target.value);
									setLowConfidenceThreshold(
										Number.isFinite(next)
											? Math.max(0, Math.min(1, next))
											: 0.55,
									);
								}}
								className="h-9 w-28 rounded-md border border-kumo-line bg-kumo-base px-2"
							/>
						</label>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
							{triageStatusCards.map(({ label, value }) => (
								<div
									key={label}
									className="rounded-md border border-kumo-line bg-kumo-recessed px-3 py-2"
								>
									<div className="text-[11px] font-medium uppercase text-kumo-subtle">
										{label}
									</div>
									<div className="mt-1 text-lg font-semibold text-kumo-default">
										{typeof value === "number" ? value : "-"}
									</div>
								</div>
							))}
						</div>
						<div className="flex flex-wrap items-center gap-2 pt-2">
							<Button
								variant="secondary"
								size="sm"
								onClick={async () => {
									if (!mailboxId) return;
									const result = await backfillTriage.mutateAsync({
										mailboxId,
										limit: 50,
									});
									toastManager.add({
										title: `Queued ${result.queued} emails for classification`,
									});
									void refetchTriageStatus();
									window.setTimeout(() => void refetchTriageStatus(), 5_000);
								}}
								loading={backfillTriage.isPending}
							>
								Classify existing mail
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={async () => {
									if (!mailboxId) return;
									const result = await backfillTriage.mutateAsync({
										mailboxId,
										limit: 50,
										force: true,
									});
									toastManager.add({
										title: `Queued ${result.queued} emails for reclassification`,
									});
									void refetchTriageStatus();
									window.setTimeout(() => void refetchTriageStatus(), 5_000);
								}}
								loading={backfillTriage.isPending}
							>
								Reclassify latest 50
							</Button>
							<Button
								variant="ghost"
								size="sm"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={() => void refetchTriageStatus()}
							>
								Refresh
							</Button>
							<span className="text-xs text-kumo-subtle">
								Labels stay attached; auto-file only moves Inbox mail.
							</span>
						</div>
					</div>
				</div>

				{/* Rules */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Rules
					</div>
					{visibleRules.length === 0 ? (
						<div className="rounded-md border border-dashed border-kumo-line px-3 py-4 text-sm text-kumo-subtle">
							No suggested rules yet.
						</div>
					) : (
						<div className="divide-y divide-kumo-line rounded-md border border-kumo-line">
							{visibleRules.map((rule) => (
								<div
									key={rule.id}
									className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
											<span className="truncate font-medium">
												{rule.label_name ?? rule.label_id}
											</span>
											<Badge variant={rule.status === "active" ? "primary" : "secondary"}>
												{rule.status}
											</Badge>
										</div>
										<div className="mt-1 truncate text-xs text-kumo-subtle">
											{rule.field} {rule.operator} {rule.value}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{rule.status !== "active" && (
											<Button
												variant="secondary"
												size="xs"
												onClick={() => void handleConfirmRule(rule.id)}
												loading={confirmRule.isPending}
											>
												Confirm
											</Button>
										)}
										{rule.status !== "disabled" && (
											<Button
												variant="ghost"
												size="xs"
												onClick={() => void handleDisableRule(rule.id)}
												loading={disableRule.isPending}
											>
												Disable
											</Button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Bulk triage */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Bulk Triage
					</div>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
						<select
							value={selectedBulkLabelId}
							onChange={(event) => setBulkLabelId(event.target.value)}
							className="h-9 rounded-md border border-kumo-line bg-kumo-base px-3 text-sm text-kumo-default"
						>
							{autoFileChoices.map((label) => (
								<option key={label.id} value={label.id}>
									{label.name}
								</option>
							))}
						</select>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => void handleBulkFile()}
								loading={bulkFileLabel.isPending}
								disabled={!selectedBulkLabelId}
							>
								Move latest 100
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => void handleBulkMarkRead()}
								loading={bulkMarkLabelRead.isPending}
								disabled={!selectedBulkLabelId}
							>
								Mark latest 100 read
							</Button>
						</div>
					</div>
				</div>

				{/* Activity */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Activity
					</div>
					{recentActivity.length === 0 ? (
						<div className="rounded-md border border-dashed border-kumo-line px-3 py-4 text-sm text-kumo-subtle">
							No triage activity yet.
						</div>
					) : (
						<div className="divide-y divide-kumo-line rounded-md border border-kumo-line">
							{recentActivity.map((event) => (
								<div
									key={event.id}
									className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
											<span className="truncate font-medium">
												{event.subject || "(No subject)"}
											</span>
											<Badge variant="secondary">
												{humanizeEventSource(event.source)}
											</Badge>
											{event.undoneAt && (
												<Badge variant="secondary">undone</Badge>
											)}
										</div>
										<div className="mt-1 truncate text-xs text-kumo-subtle">
											{event.action === "move"
												? `${event.fromFolderName ?? event.fromFolderId ?? "Folder"} -> ${event.toFolderName ?? event.toFolderId ?? "Folder"}`
												: "Marked read"}
											{event.labelName ? ` · ${event.labelName}` : ""}
											{event.createdAt ? ` · ${formatActivityDate(event.createdAt)}` : ""}
										</div>
									</div>
									{event.action === "move" && !event.undoneAt && (
										<Button
											variant="ghost"
											size="xs"
											onClick={() => void handleUndoActivity(event.id)}
											loading={undoTriageActivity.isPending}
										>
											Undo
										</Button>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save Changes
					</Button>
				</div>
			</div>
		</div>
	);
}
