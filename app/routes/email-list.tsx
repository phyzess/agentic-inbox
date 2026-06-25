// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Pagination, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	CheckSquareIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TagIcon,
	TrashIcon,
	TrayIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import MailboxSplitView from "~/components/MailboxSplitView";
import { getSnippetText } from "~/lib/utils";
import {
	useBulkEmailAction,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useLabels } from "~/queries/labels";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import type { BulkEmailAction, BulkEmailActionRequest, Email, Folder } from "~/types";

const PAGE_SIZE = 25;

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: (
			<PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description:
			"Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.SPAM]: {
		icon: <WarningCircleIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Spam is empty",
		description:
			"Messages you move here stay out of your inbox until you restore or delete them.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description:
			"Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

function EmailListSkeleton() {
	return (
		<div className="animate-pulse space-y-1 p-2">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="flex items-center gap-3 px-3 py-3">
					<div className="w-4 h-4 rounded bg-kumo-fill" />
					<div className="w-5 h-5 rounded bg-kumo-fill" />
					<div className="flex-1 space-y-2">
						<div className="flex items-center gap-2">
							<div className="h-3 w-24 rounded bg-kumo-fill" />
							<div className="h-3 w-4 rounded bg-kumo-fill" />
							<div className="h-3 flex-1 rounded bg-kumo-fill" />
							<div className="h-3 w-12 rounded bg-kumo-fill" />
						</div>
						<div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
					</div>
				</div>
			))}
		</div>
	);
}

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: (
			<EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">
				{config.title}
			</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">
				{config.description}
			</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					Compose
				</Button>
			)}
		</div>
	);
}

function BulkMoveMenu({
	folders,
	disabled,
	onMove,
}: {
	folders: Folder[];
	disabled: boolean;
	onMove: (folder: Folder) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<Tooltip content="Move to folder" side="bottom" asChild>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					icon={<FolderSimpleIcon size={18} />}
					onClick={() => setOpen((current) => !current)}
					disabled={disabled}
					aria-label="Move selected emails to folder"
				/>
			</Tooltip>
			{open && (
				<div className="absolute top-full right-0 z-50 mt-1 min-w-[180px] rounded-lg border border-kumo-line bg-kumo-elevated py-1 shadow-lg">
					<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">
						Move selected to
					</div>
					<div className="my-1 h-px bg-kumo-line" />
					{folders.map((target) => (
						<button
							key={target.id}
							type="button"
							className="w-full px-3 py-1.5 text-left text-sm text-kumo-default transition-colors hover:bg-kumo-overlay"
							onClick={() => {
								onMove(target);
								setOpen(false);
							}}
						>
							{target.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder?: string;
		labelId?: string;
	}>();
	const { labelId } = useParams<{ labelId?: string }>();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
	} = useUIStore();
	const toastManager = useKumoToastManager();
	const [page, setPage] = useState(1);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const bulkEmailAction = useBulkEmailAction();

	const params = useMemo(
		() => ({
			...(labelId ? { label: labelId } : { folder: folder || "" }),
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[folder, labelId, page],
	);

	const {
		data: emailData,
		isFetching: isRefreshing,
	} = useEmails(mailboxId, params, { refetchInterval: 30_000 });

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const { data: folders = [] } = useFolders(mailboxId);
	const { data: labels = [] } = useLabels(mailboxId);

	const folderName = useMemo(() => {
		if (labelId) {
			const found = labels.find((label) => label.id === labelId);
			return found?.name || labelId.replace(/_/g, " ");
		}
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
	}, [folders, labels, folder, labelId]);

	const isPanelOpen = selectedEmailId !== null || isComposing;
	const selectedCount = selectedIds.size;
	const visibleIds = useMemo(() => emails.map((email) => email.id), [emails]);
	const allVisibleSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

	// Track folder identity to detect folder changes vs page changes
	const prevFolderRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const viewKey = labelId ? `label:${labelId}` : `folder:${folder}`;
		const folderChanged = prevFolderRef.current !== `${mailboxId}/${viewKey}`;
		prevFolderRef.current = `${mailboxId}/${viewKey}`;

		if (folderChanged) {
			closePanel();
			setPage(1);
			setSelectedIds(new Set());
		}
	}, [mailboxId, folder, labelId, closePanel]);

	useEffect(() => {
		setSelectedIds((current) => {
			const visible = new Set(visibleIds);
			const next = new Set([...current].filter((id) => visible.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [visibleIds]);

	const toggleStar = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId)
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { starred: !email.starred },
			});
	};

	const handleRowAction = (
		e: React.MouseEvent,
		email: Email,
		action: BulkEmailAction,
		options: { confirmMessage?: string } = {},
	) => {
		e.preventDefault();
		e.stopPropagation();
		if (!mailboxId) return;
		if (options.confirmMessage && !window.confirm(options.confirmMessage)) return;
		bulkEmailAction.mutate(
			{
				mailboxId,
				body: {
					action,
					emailIds: [email.id],
					filter: !labelId ? currentFilter : undefined,
					includeThreads: !labelId,
				},
			},
			{
				onSuccess: (result) => {
					const labels: Record<BulkEmailAction, string> = {
						mark_read: "marked read",
						mark_unread: "marked unread",
						star: "starred",
						unstar: "unstarred",
						archive: "archived",
						spam: "moved to Spam",
						trash: "moved to Trash",
						restore: "moved to Inbox",
						move: "moved",
						delete: "permanently deleted",
					};
					toastManager.add({
						title: `${result.count} email${result.count === 1 ? "" : "s"} ${labels[action]}`,
					});
					if (
						selectedEmailId === email.id &&
						(action === "restore" || action === "spam" || action === "trash" || action === "delete")
					) closePanel();
				},
				onError: (err: unknown) => {
					const message =
						err instanceof Error ? err.message : "Email action failed";
					toastManager.add({ title: message, variant: "error" });
				},
			},
		);
	};

	const currentFilter = useMemo(
		() => (labelId ? { label: labelId } : { folder: folder || Folders.INBOX }),
		[labelId, folder],
	);
	const moveToFolders = useMemo(() => {
		const currentFolderId = labelId ? undefined : folder || Folders.INBOX;
		return folders.filter(
			(candidate) =>
				candidate.id !== currentFolderId &&
				candidate.id !== Folders.SENT &&
				candidate.id !== Folders.DRAFT,
		);
	}, [folders, folder, labelId]);
	const canArchiveFromView =
		folder !== Folders.ARCHIVE &&
		folder !== Folders.SPAM &&
		folder !== Folders.TRASH &&
		folder !== Folders.SENT &&
		folder !== Folders.DRAFT;
	const canReportSpamFromView =
		folder !== Folders.SPAM &&
		folder !== Folders.TRASH &&
		folder !== Folders.SENT &&
		folder !== Folders.DRAFT;
	const canRestoreFromView =
		folder === Folders.ARCHIVE ||
		folder === Folders.SPAM ||
		folder === Folders.TRASH;
	const selectedDeleteAction: BulkEmailAction =
		folder === Folders.TRASH || folder === Folders.DRAFT ? "delete" : "trash";
	const selectedDeleteTooltip =
		folder === Folders.DRAFT
			? "Discard selected drafts"
			: folder === Folders.TRASH
				? "Delete forever"
				: "Move to Trash";
	const selectedDeleteConfirm =
		folder === Folders.DRAFT
			? "Discard the selected drafts?"
			: folder === Folders.TRASH
				? "Permanently delete the selected emails?"
				: undefined;

	const toggleSelected = (emailId: string) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			if (next.has(emailId)) next.delete(emailId);
			else next.add(emailId);
			return next;
		});
	};

	const toggleAllVisible = () => {
		setSelectedIds((current) => {
			if (allVisibleSelected) return new Set();
			const next = new Set(current);
			for (const id of visibleIds) next.add(id);
			return next;
		});
	};

	const runBulkAction = async (
		action: BulkEmailAction,
		options: {
			allMatching?: boolean;
			confirmMessage?: string;
			folderId?: string;
			folderName?: string;
			includeThreads?: boolean;
		} = {},
	) => {
		if (!mailboxId) return;
		if (action === "move" && !options.folderId) return;
		if (options.confirmMessage && !window.confirm(options.confirmMessage)) return;

		const includeThreads =
			options.includeThreads ?? (!options.allMatching && !labelId);
		const body: BulkEmailActionRequest = options.allMatching
			? {
				action,
				filter: currentFilter,
				limit: 1000,
				folderId: options.folderId,
			}
			: {
				action,
				emailIds: [...selectedIds],
				folderId: options.folderId,
				includeThreads,
				filter: includeThreads ? currentFilter : undefined,
			};
		if (!options.allMatching && selectedIds.size === 0) return;

		try {
			const result = await bulkEmailAction.mutateAsync({ mailboxId, body });
			setSelectedIds(new Set());
			const changed = result.count;
			const labels: Record<BulkEmailAction, string> = {
				mark_read: "marked read",
				mark_unread: "marked unread",
				star: "starred",
				unstar: "unstarred",
				archive: "archived",
				spam: "moved to Spam",
				trash: "moved to Trash",
				restore: "moved to Inbox",
				move: "moved",
				delete: "permanently deleted",
			};
			const actionLabel =
				action === "move" && options.folderName
					? `moved to ${options.folderName}`
					: labels[action];
			toastManager.add({
				title: `${changed} email${changed === 1 ? "" : "s"} ${actionLabel}`,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Bulk action failed";
			toastManager.add({ title: message, variant: "error" });
		}
	};

	const handleRefresh = () => {
		if (mailboxId) {
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			queryClient.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		}
	};

	// Thread-aware helpers
	const hasUnread = (email: Email): boolean => {
		if (email.thread_unread_count !== undefined) {
			return email.thread_unread_count > 0;
		}
		return !email.read;
	};

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (mailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({
					mailboxId,
					threadId: email.thread_id,
				});
			} else {
				updateEmail.mutate({
					mailboxId,
					id: email.id,
					data: { read: true },
				});
			}
		}
	};

	const formatParticipants = (email: Email): string => {
		if (email.participants) {
			const names = email.participants
				.split(",")
				.map((p) => p.trim().split("@")[0])
				.filter((name, idx, arr) => arr.indexOf(name) === idx);
			if (names.length <= 3) return names.join(", ");
			return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
		}
		return email.sender.split("@")[0];
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
				{/* Folder header */}
				<div className="border-b border-kumo-line px-4 py-3 shrink-0 md:px-5">
					<div className="flex flex-wrap items-center gap-2">
						<Tooltip content={allVisibleSelected ? "Clear selection" : "Select visible"} side="bottom" asChild>
							<Button
								variant={allVisibleSelected ? "secondary" : "ghost"}
								shape="square"
								size="sm"
								icon={<CheckSquareIcon size={18} />}
								onClick={toggleAllVisible}
								aria-label={allVisibleSelected ? "Clear selection" : "Select visible emails"}
								disabled={emails.length === 0}
							/>
						</Tooltip>
						<h1 className="min-w-0 flex-1 text-lg font-semibold text-kumo-default">
							<span className="inline-flex min-w-0 items-center gap-2">
								{labelId && <TagIcon size={18} className="shrink-0" />}
								<span className="truncate">{folderName}</span>
							</span>
						</h1>
						{selectedCount > 0 ? (
							<div className="flex flex-wrap items-center gap-1">
								<span className="mr-1 text-sm text-kumo-subtle">
									{selectedCount} selected
								</span>
								<Tooltip content="Mark read" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<EnvelopeOpenIcon size={18} />}
										onClick={() => void runBulkAction("mark_read")}
										loading={bulkEmailAction.isPending}
										aria-label="Mark selected emails read"
									/>
								</Tooltip>
								<Tooltip content="Mark unread" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<EnvelopeSimpleIcon size={18} />}
										onClick={() => void runBulkAction("mark_unread")}
										loading={bulkEmailAction.isPending}
										aria-label="Mark selected emails unread"
									/>
								</Tooltip>
								<Tooltip content="Star" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<StarIcon size={18} />}
										onClick={() => void runBulkAction("star")}
										loading={bulkEmailAction.isPending}
										aria-label="Star selected emails"
									/>
								</Tooltip>
								<Tooltip content="Unstar" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<StarIcon size={18} weight="fill" />}
										onClick={() => void runBulkAction("unstar")}
										loading={bulkEmailAction.isPending}
										aria-label="Unstar selected emails"
									/>
								</Tooltip>
								{canArchiveFromView && (
									<Tooltip content="Archive" side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<ArchiveIcon size={18} />}
											onClick={() => void runBulkAction("archive")}
											loading={bulkEmailAction.isPending}
											aria-label="Archive selected emails"
										/>
									</Tooltip>
								)}
								{canReportSpamFromView && (
									<Tooltip content="Report spam" side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<WarningCircleIcon size={18} />}
											onClick={() => void runBulkAction("spam")}
											loading={bulkEmailAction.isPending}
											aria-label="Report selected emails as spam"
										/>
									</Tooltip>
								)}
								{folder === Folders.TRASH || folder === Folders.ARCHIVE || folder === Folders.SPAM ? (
									<Tooltip content={folder === Folders.SPAM ? "Not spam" : "Move to Inbox"} side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<TrayIcon size={18} />}
											onClick={() => void runBulkAction("restore")}
											loading={bulkEmailAction.isPending}
											aria-label={folder === Folders.SPAM ? "Move selected emails out of Spam" : "Move selected emails to Inbox"}
										/>
									</Tooltip>
								) : null}
								{moveToFolders.length > 0 && (
									<BulkMoveMenu
										folders={moveToFolders}
										disabled={bulkEmailAction.isPending}
										onMove={(target) =>
											void runBulkAction("move", {
												folderId: target.id,
												folderName: target.name,
											})
										}
									/>
								)}
								<Tooltip content={selectedDeleteTooltip} side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<TrashIcon size={18} />}
										onClick={() =>
											void runBulkAction(
												selectedDeleteAction,
												selectedDeleteConfirm
													? { confirmMessage: selectedDeleteConfirm }
													: {},
											)
										}
										loading={bulkEmailAction.isPending}
										aria-label={selectedDeleteTooltip}
									/>
								</Tooltip>
							</div>
						) : (
							<div className="flex items-center gap-1">
								{totalCount > 0 && (
									<span className="text-sm text-kumo-subtle mr-2 hidden sm:inline">
										{totalCount} conversation{totalCount !== 1 ? "s" : ""}
									</span>
								)}
								{totalCount > 0 && (
									<>
										{(folder === Folders.TRASH || folder === Folders.SPAM) && (
											<Button
												variant="secondary"
												size="sm"
												icon={<TrashIcon size={16} />}
												onClick={() =>
													void runBulkAction("delete", {
														allMatching: true,
														confirmMessage:
															folder === Folders.SPAM
																? "Permanently delete all emails in Spam?"
																: "Permanently delete all emails in Trash?",
													})
												}
												loading={bulkEmailAction.isPending}
												className="hidden sm:inline-flex"
											>
												{folder === Folders.SPAM ? "Empty Spam" : "Empty Trash"}
											</Button>
										)}
										<Button
											variant="secondary"
											size="sm"
											icon={<EnvelopeOpenIcon size={16} />}
											onClick={() => void runBulkAction("mark_read", { allMatching: true })}
											loading={bulkEmailAction.isPending}
											className="hidden sm:inline-flex"
										>
											Mark all read
										</Button>
										<Tooltip content="Mark all read" side="bottom" asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={<EnvelopeOpenIcon size={18} />}
												onClick={() => void runBulkAction("mark_read", { allMatching: true })}
												loading={bulkEmailAction.isPending}
												aria-label="Mark all emails read"
												className="sm:hidden"
											/>
										</Tooltip>
									</>
								)}
								<Tooltip
									content={isRefreshing ? "Refreshing..." : "Refresh"}
									side="bottom"
									asChild
								>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={
											<ArrowsClockwiseIcon
												size={18}
												className={isRefreshing ? "animate-spin" : ""}
											/>
										}
										onClick={handleRefresh}
										disabled={isRefreshing}
										aria-label="Refresh"
									/>
								</Tooltip>
							</div>
						)}
					</div>
				</div>

				{/* Email rows */}
				<div className="flex-1 overflow-y-auto">
				{isRefreshing && emails.length === 0 ? (
					<EmailListSkeleton />
				) : emails.length > 0 ? (
						<div>
							{emails.map((email) => {
								const isSelected = selectedEmailId === email.id;
								const isChecked = selectedIds.has(email.id);
								const snippet = getSnippetText(email.snippet);
								const rowDeleteAction: BulkEmailAction =
									folder === Folders.TRASH || folder === Folders.DRAFT ? "delete" : "trash";
								const rowDeleteTooltip =
									folder === Folders.DRAFT
										? "Discard draft"
										: folder === Folders.TRASH
											? "Delete forever"
											: "Move to Trash";
								const rowDeleteConfirm =
									folder === Folders.DRAFT
										? "Discard this draft?"
										: folder === Folders.TRASH
											? "Permanently delete this email?"
											: undefined;
								return (
									<div
										key={email.id}
										role="button"
										tabIndex={0}
										onClick={() => handleRowClick(email)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												handleRowClick(email);
											}
										}}
										className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 md:px-6 md:py-3 ${
											isPanelOpen ? "md:px-4 md:py-2.5" : ""
										} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
									>
										{/* Unread dot */}
										<div className="w-2.5 shrink-0 flex justify-center">
											{hasUnread(email) && (
												<div className="h-2 w-2 rounded-full bg-kumo-brand" />
											)}
										</div>

										<input
											type="checkbox"
											checked={isChecked}
											onChange={() => toggleSelected(email.id)}
											onClick={(e) => e.stopPropagation()}
											aria-label={`Select ${email.subject || "email"}`}
											className="h-4 w-4 shrink-0 accent-kumo-brand"
										/>

										{/* Star */}
										<button
											type="button"
											className="shrink-0 p-0.5 bg-transparent border-0 cursor-pointer"
											onClick={(e) => {
												e.stopPropagation();
												toggleStar(e, email);
											}}
										>
											<StarIcon
												size={16}
												weight={email.starred ? "fill" : "regular"}
												className={
													email.starred
														? "text-kumo-warning"
														: "text-kumo-subtle hover:text-kumo-warning"
												}
											/>
										</button>

										{/* Content */}
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span
													className={`truncate text-sm ${hasUnread(email) ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}
												>
													{formatParticipants(email)}
												</span>
												{(email.thread_count ?? 1) > 1 && (
													<span className="shrink-0 text-xs text-kumo-subtle bg-kumo-fill rounded-full px-1.5 py-0.5 font-medium">
														{email.thread_count}
													</span>
												)}
												{email.has_draft && (
													<span className="shrink-0 text-xs text-kumo-destructive font-medium">
														Draft
													</span>
												)}
												{email.needs_reply && !email.has_draft && (
													<Tooltip content="Needs reply" asChild>
														<span className="shrink-0 text-kumo-warning">
															<ArrowBendUpLeftIcon size={14} weight="bold" />
														</span>
													</Tooltip>
												)}
												{email.labels?.slice(0, 2).map((label) => (
													<Tooltip
														key={label.id}
														content={`${label.reason || label.name}${label.confidence != null ? ` (${Math.round(label.confidence * 100)}%)` : ""}`}
														asChild
													>
														<span>
															<Badge variant="outline">
																<span
																	className="inline-block h-2 w-2 rounded-full mr-1"
																	style={{ backgroundColor: label.color || "#64748b" }}
																/>
																{label.name}
															</Badge>
														</span>
													</Tooltip>
												))}
												<span className="text-sm text-kumo-subtle shrink-0 ml-auto">
													{formatListDate(email.date)}
												</span>
											</div>
											<div className="truncate text-sm mt-0.5">
												<span
													className={hasUnread(email) ? "font-medium text-kumo-default" : "text-kumo-subtle"}
												>
													{email.subject}
												</span>
											{snippet && (
												<span className="text-kumo-subtle font-normal">
													{" "}&mdash; {snippet}
												</span>
											)}
										</div>
									</div>

										{/* Hover actions */}
										<div className="hidden group-hover:flex items-center shrink-0">
											<Tooltip content={hasUnread(email) ? "Mark read" : "Mark unread"} asChild>
												<Button
													variant="ghost"
													shape="square"
													size="sm"
													icon={hasUnread(email) ? <EnvelopeOpenIcon size={14} /> : <EnvelopeSimpleIcon size={14} />}
													onClick={(e) =>
														handleRowAction(
															e,
															email,
															hasUnread(email) ? "mark_read" : "mark_unread",
														)
													}
													aria-label={hasUnread(email) ? "Mark read" : "Mark unread"}
												/>
											</Tooltip>
											{canArchiveFromView && (
												<Tooltip content="Archive" asChild>
													<Button
														variant="ghost"
														shape="square"
														size="sm"
														icon={<ArchiveIcon size={14} />}
														onClick={(e) => handleRowAction(e, email, "archive")}
														aria-label="Archive"
													/>
												</Tooltip>
											)}
											{canRestoreFromView && (
												<Tooltip content={folder === Folders.SPAM ? "Not spam" : "Move to Inbox"} asChild>
													<Button
														variant="ghost"
														shape="square"
														size="sm"
														icon={<TrayIcon size={14} />}
														onClick={(e) => handleRowAction(e, email, "restore")}
														aria-label={folder === Folders.SPAM ? "Move out of Spam" : "Move to Inbox"}
													/>
												</Tooltip>
											)}
											{canReportSpamFromView && (
												<Tooltip content="Report spam" asChild>
													<Button
														variant="ghost"
														shape="square"
														size="sm"
														icon={<WarningCircleIcon size={14} />}
														onClick={(e) => handleRowAction(e, email, "spam")}
														aria-label="Report spam"
													/>
												</Tooltip>
											)}
											<Tooltip content={rowDeleteTooltip} asChild>
												<Button
													variant="ghost"
													shape="square"
													size="sm"
													icon={<TrashIcon size={14} />}
													onClick={(e) =>
														handleRowAction(
															e,
															email,
															rowDeleteAction,
															rowDeleteConfirm
																? { confirmMessage: rowDeleteConfirm }
																: {},
														)
													}
													aria-label={rowDeleteTooltip}
												/>
											</Tooltip>
										</div>
									</div>
								);
							})}
						</div>
					) : (
						<FolderEmptyState
							folder={folder}
							onCompose={() => startCompose()}
						/>
					)}
				</div>

				{/* Pagination */}
				{totalCount > PAGE_SIZE && (
					<div className="flex justify-center py-3 border-t border-kumo-line shrink-0">
						<Pagination
							page={page}
							setPage={setPage}
							perPage={PAGE_SIZE}
							totalCount={totalCount}
						/>
					</div>
				)}
		</MailboxSplitView>
	);
}
