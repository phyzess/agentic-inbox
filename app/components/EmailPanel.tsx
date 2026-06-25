// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import EmailPanelDialogs from "~/components/email-panel/EmailPanelDialogs";
import EmailPanelHeader from "~/components/email-panel/EmailPanelHeader";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import SingleMessageView from "~/components/email-panel/SingleMessageView";
import ThreadMessage from "~/components/email-panel/ThreadMessage";
import { splitEmailList, toEmailListValue } from "~/lib/utils";
import api from "~/services/api";
import { useBulkEmailAction, useDeleteEmail, useEmail, useReplyToEmail, useSendEmail, useThreadReplies, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useApplyLabel, useClassifyEmail, useConfirmRule, useDisableRule, useLabels, useRules } from "~/queries/labels";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import type { BulkEmailAction, Email, Folder, Mailbox } from "~/types";

function EmailPanelSkeleton() {
	return (
		<div className="animate-pulse p-5 space-y-4">
			<div className="h-5 w-2/3 rounded bg-kumo-fill" />
			<div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-kumo-fill" /><div className="space-y-2 flex-1"><div className="h-3 w-40 rounded bg-kumo-fill" /><div className="h-2.5 w-24 rounded bg-kumo-fill" /></div></div>
			<div className="space-y-2 pt-4"><div className="h-2.5 w-full rounded bg-kumo-fill" /><div className="h-2.5 w-5/6 rounded bg-kumo-fill" /><div className="h-2.5 w-4/6 rounded bg-kumo-fill" /><div className="h-2.5 w-3/4 rounded bg-kumo-fill" /></div>
		</div>
	);
}

function emailRuleTarget(email: Email, field: string) {
	switch (field) {
		case "sender":
			return email.sender;
		case "sender_domain":
			return email.sender.split("@")[1] || "";
		case "recipient":
			return email.recipient;
		case "subject":
			return email.subject;
		case "body":
			return email.body || "";
		case "list_id":
			return email.raw_headers || "";
		default:
			return "";
	}
}

function ruleMatchesEmail(
	email: Email,
	rule: { field: string; operator: string; value: string },
) {
	const value = rule.value.toLowerCase().trim();
	const target = emailRuleTarget(email, rule.field).toLowerCase();
	if (!value || !target) return false;

	switch (rule.operator) {
		case "equals":
			return target.trim() === value;
		case "contains":
			return target.includes(value);
		case "starts_with":
			return target.trim().startsWith(value);
		default:
			return false;
	}
}

export default function EmailPanel({ emailId }: { emailId: string }) {
	const { mailboxId, folder } = useParams<{ mailboxId: string; folder: string }>();
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: threadRepliesRaw } = useThreadReplies(mailboxId, email?.thread_id) as {
		data?: Email[];
	};
	const updateEmail = useUpdateEmail();
	const deleteEmailMut = useDeleteEmail();
	const bulkEmailAction = useBulkEmailAction();
	const sendEmailMut = useSendEmail();
	const replyMut = useReplyToEmail();
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };
	const { data: labels = [] } = useLabels(mailboxId);
	const { data: rules = [] } = useRules(mailboxId);
	const applyLabel = useApplyLabel();
	const classifyEmail = useClassifyEmail();
	const confirmRule = useConfirmRule();
	const disableRule = useDisableRule();
	const { data: currentMailbox } = useMailbox(mailboxId) as {
		data?: Mailbox;
	};
	const { closePanel, startCompose } = useUIStore();
	const toastManager = useKumoToastManager();
	const [isSending, setIsSending] = useState(false);
	const [sourceViewEmail, setSourceViewEmail] = useState<Email | null>(null);
	const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
	const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
	const isDraftFolder = folder === Folders.DRAFT || email?.folder_id === Folders.DRAFT;

	const threadReplies = useMemo(() => {
		if (!threadRepliesRaw || !email) return [];
		return threadRepliesRaw.filter((e) => e.id !== email.id);
	}, [threadRepliesRaw, email]);

	const allMessages = useMemo(() => {
		if (!email) return [];
		return [email, ...threadReplies].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [email, threadReplies]);

	// Reset expanded state only when the selected email changes, not on every refetch.
	// Using allMessages as a dependency would reset user expand/collapse state on background refetches.
	const currentEmailId = email?.id;
	useEffect(() => { if (allMessages.length > 1) setExpandedMessages(new Set([allMessages[0].id])); }, [currentEmailId]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggleExpand = (msgId: string) => { setExpandedMessages((prev) => { const next = new Set(prev); if (next.has(msgId)) next.delete(msgId); else next.add(msgId); return next; }); };

	const draftMessageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const msg of allMessages) { if (msg.folder_id === Folders.DRAFT) ids.add(msg.id); else if (isDraftFolder && msg.id === emailId) ids.add(msg.id); }
		return ids;
	}, [allMessages, isDraftFolder, emailId]);

	const lastReceivedMessage = useMemo(() => {
		const ce = currentMailbox?.email;
		const received = allMessages.filter((msg) => !draftMessageIds.has(msg.id) && msg.sender !== ce);
		if (received.length > 0) return received[0];
		const nonDrafts = allMessages.filter((msg) => !draftMessageIds.has(msg.id));
		return nonDrafts.length > 0 ? nonDrafts[0] : email;
	}, [allMessages, draftMessageIds, currentMailbox?.email, email]);

	const activeFolderId = email?.folder_id || folder;
	const moveToFolders = useMemo(() => {
		const cur = activeFolderId;
		return folders.filter(
			(f) =>
				f.id !== cur &&
				f.id !== Folders.SENT &&
				f.id !== Folders.DRAFT,
		);
	}, [folders, activeFolderId]);
	const suggestedRules = useMemo(() => {
		const currentLabelId = email?.labels?.[0]?.id;
		if (!email || !currentLabelId) return [];
		return rules.filter(
			(rule) =>
				rule.status === "suggested" &&
				rule.label_id === currentLabelId &&
				ruleMatchesEmail(email, rule),
		);
	}, [email, rules]);

	if (!email) return <EmailPanelSkeleton />;

	const hasThread = allMessages.length > 1;
	const toggleStar = () => { if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } }); };
	const runThreadAwareAction = async (
		action: BulkEmailAction,
		options: { folderId?: string; confirmMessage?: string; closeOnSuccess?: boolean } = {},
	) => {
		if (!mailboxId) return;
		if (options.confirmMessage && !window.confirm(options.confirmMessage)) return;

		try {
			const result = await bulkEmailAction.mutateAsync({
				mailboxId,
				body: {
					action,
					emailIds: [email.id],
					filter: activeFolderId ? { folder: activeFolderId } : undefined,
					includeThreads: hasThread,
					folderId: options.folderId,
				},
			});
			const count = result.count;
			const labels: Record<BulkEmailAction, string> = {
				mark_read: "marked read",
				mark_unread: "marked unread",
				star: "starred",
				unstar: "unstarred",
				archive: "archived",
				spam: "moved to Spam",
				trash: "moved to Trash",
				restore: "moved to Inbox",
				move: options.folderId === Folders.INBOX ? "moved to Inbox" : "moved",
				delete: "permanently deleted",
			};
			toastManager.add({
				title: `${count} email${count === 1 ? "" : "s"} ${labels[action]}`,
			});
			if (options.closeOnSuccess !== false) closePanel();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Email action failed";
			toastManager.add({ title: message, variant: "error" });
		}
	};
	const handleMove = (folderId: string) => {
		void runThreadAwareAction("move", { folderId });
	};
	const restoreLabel =
		activeFolderId === Folders.SPAM
			? "Not spam"
			: activeFolderId === Folders.ARCHIVE || activeFolderId === Folders.TRASH
				? "Move to Inbox"
				: undefined;
	const canArchive =
		!isDraftFolder &&
		activeFolderId !== Folders.ARCHIVE &&
		activeFolderId !== Folders.SPAM &&
		activeFolderId !== Folders.TRASH &&
		activeFolderId !== Folders.SENT;
	const canReportSpam =
		!isDraftFolder &&
		activeFolderId !== Folders.SPAM &&
		activeFolderId !== Folders.TRASH &&
		activeFolderId !== Folders.SENT;
	const deleteLabel = isDraftFolder
		? "Discard draft"
		: activeFolderId === Folders.TRASH
			? "Delete forever"
			: "Move to Trash";
	const handleDelete = () => {
		if (!mailboxId) return;
		if (isDraftFolder) {
			if (!window.confirm("Discard this draft?")) return;
			deleteEmailMut.mutate({ mailboxId, id: email.id });
			toastManager.add({ title: "Draft discarded" });
			closePanel();
			return;
		}
		if (email.folder_id === Folders.TRASH || folder === Folders.TRASH) {
			void runThreadAwareAction("delete", {
				confirmMessage: "Permanently delete this email?",
			});
			return;
		}
		void runThreadAwareAction("trash");
	};

	const handleEditDraft = (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (target.in_reply_to) { startCompose({ mode: "reply", originalEmail: allMessages.find((msg) => msg.id === target.in_reply_to), draftEmail: target }); }
		else { startCompose({ mode: "new", originalEmail: undefined, draftEmail: target }); }
	};

	const handleDeleteDraft = async (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (!mailboxId) return;
		if (!window.confirm("Discard this draft?")) return;
		deleteEmailMut.mutate({ mailboxId, id: target.id });
		toastManager.add({ title: "Draft discarded" });
		if (target.id === emailId) closePanel();
	};

	const handleSendDraft = async (draftMsg?: Email) => {
		let target = draftMsg || email;
		if (!mailboxId || !currentMailbox) return;
		setIsSending(true);
		try {
			if (!target.recipient || !target.subject) { try { const fresh = await api.getEmail(mailboxId, target.id) as Email; if (fresh) target = fresh; } catch {} }
			if (!target.recipient) { toastManager.add({ title: "Cannot send: no recipient set on this draft.", variant: "error" }); return; }
			const toRecipients = splitEmailList(target.recipient);
			if (toRecipients.length === 0) { toastManager.add({ title: "Cannot send: no valid recipient set on this draft.", variant: "error" }); return; }
			const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
			const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
			const originalEmail = target.in_reply_to ? allMessages.find((msg) => msg.id === target.in_reply_to) : undefined;
			const emailData = {
				to: toEmailListValue(toRecipients),
				cc: toEmailListValue(splitEmailList(target.cc)),
				bcc: toEmailListValue(splitEmailList(target.bcc)),
				from,
				subject: target.subject || "(no subject)",
				html: target.body || "",
				text: target.body ? target.body.replace(/<[^>]*>/g, "").trim() : "",
			};
			if (originalEmail) await replyMut.mutateAsync({ mailboxId, emailId: originalEmail.id, email: emailData }); else await sendEmailMut.mutateAsync({ mailboxId, email: emailData });
			await deleteEmailMut.mutateAsync({ mailboxId, id: target.id });
			toastManager.add({ title: "Email sent!" });
			if (isDraftFolder) closePanel();
		} catch (err) {
			const message = (err instanceof Error ? err.message : null) || "Failed to send email.";
			toastManager.add({ title: message, variant: "error" });
		} finally { setIsSending(false); }
	};

	return (
		<div className="flex flex-col h-full">
			<EmailPanelToolbar
				email={email}
				mailboxId={mailboxId}
				isDraftFolder={isDraftFolder}
				isSending={isSending}
				moveToFolders={moveToFolders}
				onBack={closePanel}
				onSendDraft={() => handleSendDraft()}
				onEditDraft={() => handleEditDraft()}
				onReply={() =>
					startCompose({ mode: "reply", originalEmail: lastReceivedMessage })
				}
				onReplyAll={() =>
					startCompose({
						mode: "reply-all",
						originalEmail: lastReceivedMessage,
					})
				}
				onForward={() => startCompose({ mode: "forward", originalEmail: email })}
				onToggleStar={toggleStar}
				onToggleRead={() => {
					if (!mailboxId) return;
					if (hasThread) {
						void runThreadAwareAction(email.read ? "mark_unread" : "mark_read", {
							closeOnSuccess: false,
						});
						return;
					}
					updateEmail.mutate({
						mailboxId,
						id: email.id,
						data: { read: !email.read },
					});
				}}
				restoreLabel={restoreLabel}
				onRestore={restoreLabel ? () => void runThreadAwareAction("restore") : undefined}
				onArchive={canArchive ? () => void runThreadAwareAction("archive") : undefined}
				onReportSpam={canReportSpam ? () => void runThreadAwareAction("spam") : undefined}
				onMove={handleMove}
				onViewSource={() => setSourceViewEmail(email)}
				deleteLabel={deleteLabel}
				onDelete={handleDelete}
			/>

			<EmailPanelHeader
				subject={email.subject}
				messageCount={allMessages.length}
				showThreadCount={hasThread}
			/>

			<div className="border-b border-kumo-line px-4 py-3 md:px-6">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs font-medium uppercase tracking-wide text-kumo-subtle">
						Smart label
					</span>
					{email.labels && email.labels.length > 0 ? (
						email.labels.map((label) => (
							<Badge key={label.id} variant="outline">
								<span
									className="inline-block h-2 w-2 rounded-full mr-1"
									style={{ backgroundColor: label.color || "#64748b" }}
								/>
								{label.name}
								{label.confidence != null
									? ` ${Math.round(label.confidence * 100)}%`
									: ""}
							</Badge>
						))
					) : (
						<Badge variant="secondary">Unclassified</Badge>
					)}
					<select
						className="h-8 rounded-md border border-kumo-line bg-kumo-base px-2 text-sm text-kumo-default"
						value={email.labels?.[0]?.id || ""}
						onChange={(event) => {
							if (!mailboxId) return;
							const labelId = event.target.value || null;
							applyLabel.mutate({
								mailboxId,
								emailId: email.id,
								labelId,
								reason: labelId
									? "Changed from the email detail panel."
									: "Cleared from the email detail panel.",
							});
						}}
					>
						<option value="">Unclassified</option>
						{labels.map((label) => (
							<option key={label.id} value={label.id}>
								{label.name}
							</option>
						))}
					</select>
					<Button
						variant="secondary"
						size="sm"
						onClick={() =>
							mailboxId &&
							classifyEmail.mutate({
								mailboxId,
								emailId: email.id,
								force: true,
							})
						}
						loading={classifyEmail.isPending}
					>
						Reclassify
					</Button>
				</div>
				{email.labels?.[0]?.reason && (
					<p className="mt-2 text-xs text-kumo-subtle">
						{email.labels[0].source}: {email.labels[0].reason}
					</p>
				)}
				{suggestedRules.length > 0 && (
					<div className="mt-3 space-y-2">
						{suggestedRules.slice(0, 3).map((rule) => (
							<div
								key={rule.id}
								className="flex flex-wrap items-center gap-2 rounded-md border border-kumo-line px-3 py-2 text-xs"
							>
								<span className="text-kumo-strong">
									{`Suggested rule: ${rule.field} ${rule.operator} "${rule.value}" -> ${rule.label_name || rule.label_id}`}
								</span>
								<Button
									variant="primary"
									size="xs"
									onClick={() =>
										mailboxId &&
										confirmRule.mutate({ mailboxId, ruleId: rule.id })
									}
								>
									Confirm
								</Button>
								<Button
									variant="ghost"
									size="xs"
									onClick={() =>
										mailboxId &&
										disableRule.mutate({ mailboxId, ruleId: rule.id })
									}
								>
									Disable
								</Button>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="flex-1 overflow-y-auto">
				{hasThread ? (
					allMessages.map((msg, idx) => {
						const isDraft = draftMessageIds.has(msg.id);
						return (
							<ThreadMessage
								key={msg.id}
								email={msg}
								mailboxId={mailboxId}
								mailboxEmail={currentMailbox?.email}
								isLast={idx === allMessages.length - 1}
								isDraft={isDraft}
								isSending={isDraft ? isSending : false}
								isExpanded={expandedMessages.has(msg.id)}
								onToggleExpand={() => toggleExpand(msg.id)}
								onSendDraft={isDraft ? () => handleSendDraft(msg) : undefined}
								onEditDraft={isDraft ? () => handleEditDraft(msg) : undefined}
								onDeleteDraft={isDraft ? () => handleDeleteDraft(msg) : undefined}
								onViewSource={() => setSourceViewEmail(msg)}
								onPreviewImage={(url, filename) =>
									setPreviewImage({ url, filename })
								}
							/>
						);
					})
				) : (
					<SingleMessageView
						email={email}
						mailboxId={mailboxId}
						onPreviewImage={(url, filename) =>
							setPreviewImage({ url, filename })
						}
					/>
				)}
			</div>

			<EmailPanelDialogs
				sourceViewEmail={sourceViewEmail}
				previewImage={previewImage}
				onCloseSource={() => setSourceViewEmail(null)}
				onClosePreview={() => setPreviewImage(null)}
			/>
		</div>
	);
}
