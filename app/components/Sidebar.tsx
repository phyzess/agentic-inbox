// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	CaretLeftIcon,
	FileIcon,
	FolderIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	RobotIcon,
	TagIcon,
	TrashIcon,
	TrayIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from "~/queries/folders";
import { useLabels } from "~/queries/labels";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
	[Folders.INBOX]: <TrayIcon size={18} weight="regular" />,
	[Folders.SENT]: <PaperPlaneTiltIcon size={18} weight="regular" />,
	[Folders.DRAFT]: <FileIcon size={18} weight="regular" />,
	[Folders.ARCHIVE]: <ArchiveIcon size={18} weight="regular" />,
	[Folders.SPAM]: <WarningCircleIcon size={18} weight="regular" />,
	[Folders.TRASH]: <TrashIcon size={18} weight="regular" />,
};

const SYSTEM_FOLDER_LINKS = [
	{ id: Folders.INBOX, label: "Inbox" },
	{ id: Folders.SENT, label: "Sent" },
	{ id: Folders.DRAFT, label: "Drafts" },
	{ id: Folders.ARCHIVE, label: "Archive" },
	{ id: Folders.SPAM, label: "Spam" },
	{ id: Folders.TRASH, label: "Trash" },
];

interface FolderLinkProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	unreadCount?: number;
	onClick?: () => void;
}

function FolderLink({
	to,
	icon,
	label,
	unreadCount,
	onClick,
}: FolderLinkProps) {
	return (
		<NavLink
			to={to}
			onClick={onClick}
			className={({ isActive }) =>
				`flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
					isActive
						? "bg-kumo-fill font-semibold text-kumo-default"
						: "text-kumo-strong hover:bg-kumo-tint"
				}`
			}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate flex-1">{label}</span>
			{unreadCount != null && unreadCount > 0 && (
				<Badge variant="secondary">{unreadCount}</Badge>
			)}
		</NavLink>
	);
}

export default function Sidebar() {
	const { mailboxId, folder } = useParams<{ mailboxId: string; folder?: string }>();
	const location = useLocation();
	const navigate = useNavigate();
	const toastManager = useKumoToastManager();
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: labels = [] } = useLabels(mailboxId);
	const createFolderMutation = useCreateFolder();
	const updateFolderMutation = useUpdateFolder();
	const deleteFolderMutation = useDeleteFolder();
	const { startCompose, openComposeModal, closeSidebar } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [renameFolder, setRenameFolder] = useState<{ id: string; name: string } | null>(null);
	const [renameFolderName, setRenameFolderName] = useState("");

	const customFolders = useMemo(
		() =>
			folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);

	const getUnreadCount = (folderId: string) => {
		const found = folders.find((f) => f.id === folderId);
		return found?.unreadCount || 0;
	};

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const handleDeleteFolder = (target: { id: string; name: string }) => {
		if (!mailboxId) return;
		const confirmed = window.confirm(
			`Delete "${target.name}"? Emails in this folder will move back to Inbox.`,
		);
		if (!confirmed) return;

		deleteFolderMutation.mutate(
			{ mailboxId, id: target.id },
			{
				onSuccess: () => {
					toastManager.add({ title: `Deleted ${target.name}` });
					if (folder === target.id) {
						navigate(`/mailbox/${mailboxId}/emails/${Folders.INBOX}`);
					}
				},
				onError: () => {
					toastManager.add({
						title: `Failed to delete ${target.name}`,
						variant: "error",
					});
				},
			},
		);
	};

	const openRenameFolder = (target: { id: string; name: string }) => {
		setRenameFolder(target);
		setRenameFolderName(target.name);
	};

	const handleRenameFolder = (event: React.FormEvent) => {
		event.preventDefault();
		const nextName = renameFolderName.trim();
		if (!mailboxId || !renameFolder || !nextName) return;
		updateFolderMutation.mutate(
			{ mailboxId, id: renameFolder.id, name: nextName },
			{
				onSuccess: () => {
					toastManager.add({ title: `Renamed to ${nextName}` });
					setRenameFolder(null);
					setRenameFolderName("");
				},
				onError: () => {
					toastManager.add({
						title: `Failed to rename ${renameFolder.name}`,
						variant: "error",
					});
				},
			},
		);
	};

	const displayName = useMemo(() => {
		if (!currentMailbox) return mailboxId?.split("@")[0] || "Mailbox";
		// Prefer settings.fromName > name > local part of email
		if (currentMailbox.settings?.fromName) {
			return currentMailbox.settings.fromName;
		}
		if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) {
			return currentMailbox.name;
		}
		return currentMailbox.email.split("@")[0] || currentMailbox.name;
	}, [currentMailbox, mailboxId]);

	const handleNavClick = () => {
		// Close mobile sidebar on navigation
		closeSidebar();
	};

	const isSplitComposeRoute = useMemo(() => {
		return (
			/^\/mailbox\/[^/]+\/(?:emails|labels)\//.test(location.pathname) ||
			/^\/mailbox\/[^/]+\/(?:search|review-drafts)$/.test(location.pathname)
		);
	}, [location.pathname]);

	const handleComposeClick = () => {
		if (isSplitComposeRoute) {
			startCompose();
		} else {
			openComposeModal();
		}
		closeSidebar();
	};

	return (
		<aside className="h-full w-64 bg-kumo-recessed flex flex-col shrink-0 border-r border-kumo-line">
			{/* Back + identity */}
			<div className="px-4 pt-4 pb-1">
				<button
					type="button"
					onClick={() => {
						navigate("/");
						closeSidebar();
					}}
					className="flex items-center gap-1.5 text-kumo-subtle text-sm hover:text-kumo-default transition-colors mb-2.5 cursor-pointer bg-transparent border-0 p-0"
				>
					<CaretLeftIcon size={14} />
					<span>Mailboxes</span>
				</button>
				<div className="px-1">
					<div className="text-base font-semibold text-kumo-default truncate">
						{displayName}
					</div>
					<div className="text-sm text-kumo-subtle truncate mt-0.5">
						{currentMailbox?.email || mailboxId}
					</div>
				</div>
			</div>

			{/* Compose */}
			<div className="px-3 py-3">
				<Button
					variant="primary"
					icon={<PencilSimpleIcon size={16} />}
					onClick={handleComposeClick}
					className="w-full"
				>
					Compose
				</Button>
			</div>

			<div className="px-2 pb-3">
				<NavLink
					to={`/mailbox/${mailboxId}/review-drafts`}
					onClick={handleNavClick}
					className={({ isActive }) =>
						`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
							isActive
								? "bg-kumo-fill font-semibold text-kumo-default"
								: "text-kumo-strong hover:bg-kumo-tint"
						}`
					}
				>
					<RobotIcon size={18} weight="regular" className="shrink-0" />
					<span className="min-w-0 flex-1 truncate">Review drafts</span>
					{getUnreadCount(Folders.DRAFT) > 0 && (
						<Badge variant="secondary">{getUnreadCount(Folders.DRAFT)}</Badge>
					)}
				</NavLink>
			</div>

			{/* Navigation */}
			<nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
				{SYSTEM_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={FOLDER_ICONS[folder.id]}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}

				{labels.length > 0 && (
					<div className="pt-5">
						<div className="px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Smart Labels
							</span>
						</div>
						{labels.map((label) => (
							<FolderLink
								key={label.id}
								to={`/mailbox/${mailboxId}/labels/${label.id}`}
								icon={
									<TagIcon
										size={18}
										weight="fill"
										style={{ color: label.color || undefined }}
									/>
								}
								label={label.name}
								unreadCount={label.unreadCount}
								onClick={handleNavClick}
							/>
						))}
					</div>
				)}

				{/* Custom folders */}
				{customFolders.length > 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
						{customFolders.map((folder) => (
							<div key={folder.id} className="group flex items-center gap-1">
								<div className="min-w-0 flex-1">
									<FolderLink
										to={`/mailbox/${mailboxId}/emails/${folder.id}`}
										icon={<FolderIcon size={18} />}
										label={folder.name}
										unreadCount={folder.unreadCount}
										onClick={handleNavClick}
									/>
								</div>
								<Tooltip content="Rename folder" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<PencilSimpleIcon size={15} />}
										onClick={() => openRenameFolder(folder)}
										disabled={updateFolderMutation.isPending}
										aria-label={`Rename ${folder.name}`}
										className="shrink-0 text-kumo-subtle"
									/>
								</Tooltip>
								<Tooltip content="Delete folder" asChild>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<TrashIcon size={15} />}
										onClick={() => handleDeleteFolder(folder)}
										disabled={deleteFolderMutation.isPending}
										aria-label={`Delete ${folder.name}`}
										className="shrink-0 text-kumo-subtle hover:text-kumo-error"
									/>
								</Tooltip>
							</div>
						))}
					</div>
				)}

				{/* Add folder button when no custom folders */}
				{customFolders.length === 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
					</div>
				)}
			</nav>

			{/* Create folder dialog */}
			<Dialog.Root
				open={isCreateFolderOpen}
				onOpenChange={setIsCreateFolderOpen}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Create folder
					</Dialog.Title>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={!newFolderName.trim()}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
			<Dialog.Root
				open={Boolean(renameFolder)}
				onOpenChange={(open) => {
					if (!open) {
						setRenameFolder(null);
						setRenameFolderName("");
					}
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Rename folder
					</Dialog.Title>
					<form onSubmit={handleRenameFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={renameFolderName}
							onChange={(e) => setRenameFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								loading={updateFolderMutation.isPending}
								disabled={
									!renameFolderName.trim() ||
									renameFolderName.trim() === renameFolder?.name
								}
							>
								Rename
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</aside>
	);
}
