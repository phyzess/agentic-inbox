// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Pagination, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowLeftIcon,
	CheckSquareIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	MagnifyingGlassIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Folders } from "shared/folders";
import MailboxSplitView from "~/components/MailboxSplitView";
import { formatListDate, getSnippetText } from "~/lib/utils";
import { useBulkEmailAction, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useSearchEmails, SEARCH_PAGE_SIZE } from "~/queries/search";
import { useUIStore } from "~/hooks/useUIStore";
import type { BulkEmailAction, Email, Folder } from "~/types";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "").replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "").trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) => part.toLowerCase() === lowerEscaped ? <mark key={i} className="bg-kumo-warning-muted text-kumo-default rounded-sm px-0.5">{part}</mark> : part);
	} catch { return text; }
}

function canArchiveFolder(folderId?: string | null) {
	return (
		folderId !== Folders.ARCHIVE &&
		folderId !== Folders.SPAM &&
		folderId !== Folders.TRASH &&
		folderId !== Folders.SENT &&
		folderId !== Folders.DRAFT
	);
}

function canReportSpamFolder(folderId?: string | null) {
	return (
		folderId !== Folders.SPAM &&
		folderId !== Folders.TRASH &&
		folderId !== Folders.SENT &&
		folderId !== Folders.DRAFT
	);
}

function canMoveFolder(folderId?: string | null) {
	return folderId !== Folders.SENT && folderId !== Folders.DRAFT;
}

function isRestorableFolder(folderId?: string | null) {
	return (
		folderId === Folders.ARCHIVE ||
		folderId === Folders.SPAM ||
		folderId === Folders.TRASH
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
					aria-label="Move selected search results to folder"
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

export default function SearchResultsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { selectedEmailId, isComposing, selectEmail, closePanel } = useUIStore();
	const toastManager = useKumoToastManager();
	const updateEmail = useUpdateEmail();
	const bulkEmailAction = useBulkEmailAction();
	const urlQuery = searchParams.get("q") || "";
	const [page, setPage] = useState(1);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const searchKey = useMemo(
		() => `${mailboxId ?? ""}::${urlQuery}`,
		[mailboxId, urlQuery],
	);
	const prevSearchKeyRef = useRef(searchKey);
	const searchChanged = prevSearchKeyRef.current !== searchKey;
	const currentPage = searchChanged ? 1 : page;

	useEffect(() => {
		if (!searchChanged) {
			return;
		}

		prevSearchKeyRef.current = searchKey;
		setPage(1);
		setSelectedIds(new Set());
		closePanel();
	}, [closePanel, searchChanged, searchKey]);

	const { data: folders = [] } = useFolders(mailboxId);
	const { data: searchData, isLoading } = useSearchEmails(
		mailboxId,
		urlQuery,
		currentPage,
	);
	const results = searchData?.results ?? [];
	const totalCount = searchData?.totalCount ?? 0;
	const isPanelOpen = selectedEmailId !== null || isComposing;
	const selectedCount = selectedIds.size;
	const visibleIds = useMemo(() => results.map((email) => email.id), [results]);
	const selectedResults = useMemo(
		() => results.filter((email) => selectedIds.has(email.id)),
		[results, selectedIds],
	);
	const allVisibleSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
	const moveToFolders = useMemo(
		() =>
			folders.filter(
				(folder) => folder.id !== Folders.SENT && folder.id !== Folders.DRAFT,
			),
		[folders],
	);
	const canBulkArchive =
		selectedResults.length > 0 &&
		selectedResults.every((email) => canArchiveFolder(email.folder_id));
	const canBulkReportSpam =
		selectedResults.length > 0 &&
		selectedResults.every((email) => canReportSpamFolder(email.folder_id));
	const canBulkMove =
		selectedResults.length > 0 &&
		selectedResults.every((email) => canMoveFolder(email.folder_id));
	const canBulkRestore =
		selectedResults.length > 0 &&
		selectedResults.every((email) => isRestorableFolder(email.folder_id));
	const selectedAllTrash =
		selectedResults.length > 0 &&
		selectedResults.every((email) => email.folder_id === Folders.TRASH);
	const selectedAllDraft =
		selectedResults.length > 0 &&
		selectedResults.every((email) => email.folder_id === Folders.DRAFT);
	const selectedHasDraft =
		selectedResults.some((email) => email.folder_id === Folders.DRAFT);
	const canBulkTrash = !selectedHasDraft || selectedAllDraft;
	const bulkDeleteAction: BulkEmailAction =
		selectedAllTrash || selectedAllDraft ? "delete" : "trash";
	const bulkDeleteTooltip = selectedAllDraft
		? "Discard drafts"
		: selectedAllTrash
			? "Delete forever"
			: "Move to Trash";
	const bulkDeleteConfirm = selectedAllDraft
		? "Discard the selected drafts?"
		: selectedAllTrash
			? "Permanently delete the selected emails?"
			: undefined;

	useEffect(() => {
		setSelectedIds((current) => {
			const visible = new Set(visibleIds);
			const next = new Set([...current].filter((id) => visible.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [visibleIds]);

	const hasUnread = (email: Email): boolean => {
		if (email.thread_unread_count !== undefined) {
			return email.thread_unread_count > 0;
		}
		return !email.read;
	};
	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (!mailboxId || !hasUnread(email)) return;
		bulkEmailAction.mutate({
			mailboxId,
			body: {
				action: "mark_read",
				emailIds: [email.id],
				includeThreads: true,
			},
		});
	};
	const folderDisplayName = (name: string | null | undefined): string => { if (!name) return ""; const map: Record<string, string> = { inbox: "Inbox", sent: "Sent", draft: "Drafts", archive: "Archive", spam: "Spam", trash: "Trash" }; return map[name.toLowerCase()] || name; };
	const toggleStar = (event: React.MouseEvent, email: Email) => {
		event.stopPropagation();
		if (!mailboxId) return;
		updateEmail.mutate({
			mailboxId,
			id: email.id,
			data: { starred: !email.starred },
		});
	};
	const toggleSelected = (event: React.MouseEvent | React.ChangeEvent, emailId: string) => {
		event.stopPropagation();
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
	const runBulkSearchAction = async (
		action: BulkEmailAction,
		options: {
			confirmMessage?: string;
			folderId?: string;
			folderName?: string;
		} = {},
	) => {
		if (!mailboxId || selectedIds.size === 0) return;
		if (action === "move" && !options.folderId) return;
		if (options.confirmMessage && !window.confirm(options.confirmMessage)) return;

		try {
			const result = await bulkEmailAction.mutateAsync({
				mailboxId,
				body: {
					action,
					emailIds: [...selectedIds],
					includeThreads: true,
					folderId: options.folderId,
				},
			});
			const labels: Record<BulkEmailAction, string> = {
				mark_read: "marked read",
				mark_unread: "marked unread",
				star: "starred",
				unstar: "unstarred",
				archive: "archived",
				spam: "moved to Spam",
				trash: "moved to Trash",
				restore: "moved to Inbox",
				move: options.folderName ? `moved to ${options.folderName}` : "moved",
				delete: "permanently deleted",
			};
			toastManager.add({
				title: `${result.count} email${result.count === 1 ? "" : "s"} ${labels[action]}`,
			});
			if (
				selectedEmailId &&
				selectedIds.has(selectedEmailId) &&
				!["mark_read", "mark_unread", "star", "unstar"].includes(action)
			) {
				closePanel();
			}
			setSelectedIds(new Set());
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Bulk action failed";
			toastManager.add({ title: message, variant: "error" });
		}
	};
	const runSearchResultAction = (
		event: React.MouseEvent,
		email: Email,
		action: BulkEmailAction,
		options: {
			confirmMessage?: string;
			folderId?: string;
			closePanelOnSuccess?: boolean;
		} = {},
	) => {
		event.stopPropagation();
		if (!mailboxId) return;
		if (options.confirmMessage && !window.confirm(options.confirmMessage)) return;
		bulkEmailAction.mutate(
			{
				mailboxId,
				body: {
					action,
					emailIds: [email.id],
					includeThreads: true,
					folderId: options.folderId,
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
						options.closePanelOnSuccess !== false
					) {
						closePanel();
					}
				},
				onError: (err: unknown) => {
					const message =
						err instanceof Error ? err.message : "Email action failed";
					toastManager.add({ title: message, variant: "error" });
				},
			},
		);
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
			<>
				<div className="border-b border-kumo-line px-4 py-3 shrink-0 md:px-5">
					<div className="flex flex-wrap items-center gap-2">
						<Tooltip content="Back to inbox" side="bottom" asChild>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={<ArrowLeftIcon size={18} />}
								onClick={() => navigate(`/mailbox/${mailboxId}/emails/inbox`)}
								aria-label="Back to inbox"
							/>
						</Tooltip>
						<Tooltip content={allVisibleSelected ? "Clear selection" : "Select visible"} side="bottom" asChild>
							<Button
								variant={allVisibleSelected ? "secondary" : "ghost"}
								shape="square"
								size="sm"
								icon={<CheckSquareIcon size={18} />}
								onClick={toggleAllVisible}
								aria-label={allVisibleSelected ? "Clear selection" : "Select visible search results"}
								disabled={results.length === 0}
							/>
						</Tooltip>
						<div className="min-w-0 flex-1">
							<h1 className="truncate text-lg font-semibold text-kumo-default">
								Search Results
							</h1>
							{!isLoading && (
								<span className="text-sm text-kumo-subtle">
									{totalCount} result{totalCount !== 1 ? "s" : ""}
									{urlQuery ? ` for "${urlQuery}"` : ""}
								</span>
							)}
						</div>
						{selectedCount > 0 && (
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
										onClick={() => void runBulkSearchAction("mark_read")}
										loading={bulkEmailAction.isPending}
										aria-label="Mark selected search results read"
									/>
								</Tooltip>
								<Tooltip content="Mark unread" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<EnvelopeSimpleIcon size={18} />}
										onClick={() => void runBulkSearchAction("mark_unread")}
										loading={bulkEmailAction.isPending}
										aria-label="Mark selected search results unread"
									/>
								</Tooltip>
								<Tooltip content="Star" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<StarIcon size={18} />}
										onClick={() => void runBulkSearchAction("star")}
										loading={bulkEmailAction.isPending}
										aria-label="Star selected search results"
									/>
								</Tooltip>
								<Tooltip content="Unstar" side="bottom" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<StarIcon size={18} weight="fill" />}
										onClick={() => void runBulkSearchAction("unstar")}
										loading={bulkEmailAction.isPending}
										aria-label="Unstar selected search results"
									/>
								</Tooltip>
								{canBulkArchive && (
									<Tooltip content="Archive" side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<ArchiveIcon size={18} />}
											onClick={() => void runBulkSearchAction("archive")}
											loading={bulkEmailAction.isPending}
											aria-label="Archive selected search results"
										/>
									</Tooltip>
								)}
								{canBulkReportSpam && (
									<Tooltip content="Report spam" side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<WarningCircleIcon size={18} />}
											onClick={() => void runBulkSearchAction("spam")}
											loading={bulkEmailAction.isPending}
											aria-label="Report selected search results as spam"
										/>
									</Tooltip>
								)}
								{canBulkRestore && (
									<Tooltip content="Move to Inbox" side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<TrayIcon size={18} />}
											onClick={() => void runBulkSearchAction("restore")}
											loading={bulkEmailAction.isPending}
											aria-label="Move selected search results to Inbox"
										/>
									</Tooltip>
								)}
								{canBulkMove && moveToFolders.length > 0 && (
									<BulkMoveMenu
										folders={moveToFolders}
										disabled={bulkEmailAction.isPending}
										onMove={(target) =>
											void runBulkSearchAction("move", {
												folderId: target.id,
												folderName: target.name,
											})
										}
									/>
								)}
								{canBulkTrash && (
									<Tooltip content={bulkDeleteTooltip} side="bottom" asChild>
										<Button
											variant="ghost"
											shape="square"
											size="sm"
											icon={<TrashIcon size={18} />}
											onClick={() =>
												void runBulkSearchAction(
													bulkDeleteAction,
													bulkDeleteConfirm
														? { confirmMessage: bulkDeleteConfirm }
														: {},
												)
											}
											loading={bulkEmailAction.isPending}
											aria-label={bulkDeleteTooltip}
										/>
									</Tooltip>
								)}
							</div>
						)}
					</div>
				</div>
				<div className="flex-1 overflow-y-auto">
					{isLoading ? <div className="flex justify-center py-16"><Loader size="lg" /></div> : results.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
							<div className="mb-4"><MagnifyingGlassIcon size={48} weight="thin" className="text-kumo-subtle" /></div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">No results found</h3>
							<p className="text-sm text-kumo-subtle max-w-xs">{urlQuery ? `Nothing matched "${urlQuery}". Try different keywords or check your spelling.` : "Enter a search term to find emails by subject, sender, or content."}</p>
							{urlQuery && <p className="text-xs text-kumo-subtle mt-3 max-w-sm">Tip: Use operators like <code className="bg-kumo-tint px-1 rounded">from:name</code>, <code className="bg-kumo-tint px-1 rounded">is:unread</code>, <code className="bg-kumo-tint px-1 rounded">has:attachment</code>, <code className="bg-kumo-tint px-1 rounded">before:2025-01-01</code></p>}
						</div>
					) : (
						<div>{results.map((email) => {
							const isSelected = selectedEmailId === email.id;
							const snippet = getSnippetText(email.snippet, 120);
							const folderName = (email as Email & { folder_name?: string }).folder_name;
							const canArchive = canArchiveFolder(email.folder_id);
							const canReportSpam = canReportSpamFolder(email.folder_id);
							const canRestore = isRestorableFolder(email.folder_id);
							const rowDeleteAction: BulkEmailAction =
								email.folder_id === Folders.TRASH || email.folder_id === Folders.DRAFT
									? "delete"
									: "trash";
							const rowDeleteTooltip =
								email.folder_id === Folders.DRAFT
									? "Discard draft"
									: email.folder_id === Folders.TRASH
										? "Delete forever"
										: "Move to Trash";
							const rowDeleteConfirm =
								email.folder_id === Folders.DRAFT
									? "Discard this draft?"
									: email.folder_id === Folders.TRASH
										? "Permanently delete this email?"
										: undefined;
							return (
								<div key={email.id} role="button" tabIndex={0} onClick={() => handleRowClick(email)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(email); } }} className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 md:px-5 md:py-3 ${isPanelOpen ? "md:px-4 md:py-2.5" : ""} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}>
									<div className="w-2.5 shrink-0 flex justify-center">{hasUnread(email) && <div className="h-2 w-2 rounded-full bg-kumo-brand" />}</div>
									<input
										type="checkbox"
										checked={selectedIds.has(email.id)}
										onChange={(event) => toggleSelected(event, email.id)}
										onClick={(event) => event.stopPropagation()}
										aria-label={`Select ${email.subject || "email"}`}
										className="h-4 w-4 shrink-0 accent-kumo-brand"
									/>
									<button
										type="button"
										className="shrink-0 bg-transparent border-0 p-0.5"
										onClick={(event) => toggleStar(event, email)}
										aria-label={email.starred ? "Unstar" : "Star"}
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
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2"><span className={`truncate text-sm ${hasUnread(email) ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}>{highlightTerms(email.sender.split("@")[0], urlQuery)}</span>{folderName && <Badge variant="outline">{folderDisplayName(folderName)}</Badge>}<span className="text-sm text-kumo-subtle shrink-0 ml-auto">{formatListDate(email.date)}</span></div>
										<div className={`truncate text-sm mt-0.5 ${hasUnread(email) ? "font-medium text-kumo-default" : "text-kumo-subtle"}`}>{highlightTerms(email.subject, urlQuery)}</div>
										{snippet && <div className="truncate text-xs text-kumo-subtle mt-0.5">{highlightTerms(snippet, urlQuery)}</div>}
									</div>
									<div className="hidden items-center gap-0.5 group-hover:flex">
										<Tooltip content={hasUnread(email) ? "Mark read" : "Mark unread"} asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={hasUnread(email) ? <EnvelopeOpenIcon size={14} /> : <EnvelopeSimpleIcon size={14} />}
												onClick={(event) =>
													runSearchResultAction(
														event,
														email,
														hasUnread(email) ? "mark_read" : "mark_unread",
														{ closePanelOnSuccess: false },
													)
												}
												aria-label={hasUnread(email) ? "Mark read" : "Mark unread"}
											/>
										</Tooltip>
										{canRestore ? (
											<Tooltip content={email.folder_id === Folders.SPAM ? "Not spam" : "Move to Inbox"} asChild>
												<Button
													variant="ghost"
													shape="square"
													size="sm"
													icon={<TrayIcon size={14} />}
													onClick={(event) =>
														runSearchResultAction(event, email, "restore")
													}
													aria-label={email.folder_id === Folders.SPAM ? "Move out of Spam" : "Move to Inbox"}
												/>
											</Tooltip>
										) : canArchive ? (
											<Tooltip content="Archive" asChild>
												<Button
													variant="ghost"
													shape="square"
													size="sm"
													icon={<ArchiveIcon size={14} />}
													onClick={(event) =>
														runSearchResultAction(event, email, "archive")
													}
													aria-label="Archive"
												/>
											</Tooltip>
										) : null}
										{canReportSpam && (
											<Tooltip content="Report spam" asChild>
												<Button
													variant="ghost"
													shape="square"
													size="sm"
													icon={<WarningCircleIcon size={14} />}
													onClick={(event) =>
														runSearchResultAction(event, email, "spam")
													}
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
												onClick={(event) =>
													runSearchResultAction(
														event,
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
						})}</div>
					)}
				</div>
				{totalCount > SEARCH_PAGE_SIZE && <div className="flex justify-center py-3 border-t border-kumo-line shrink-0"><Pagination page={currentPage} setPage={setPage} perPage={SEARCH_PAGE_SIZE} totalCount={totalCount} /></div>}
			</>
		</MailboxSplitView>
	);
}
