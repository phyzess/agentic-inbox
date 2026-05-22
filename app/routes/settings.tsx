// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { RobotIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { DEFAULT_AUTO_FILE_LABEL_IDS, DEFAULT_SMART_LABELS } from "shared/labels";
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
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

function formatActivityDate(value?: string | null) {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString();
}

function humanizeEventSource(source: string) {
	return source.replaceAll("_", " ");
}

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
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

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
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
