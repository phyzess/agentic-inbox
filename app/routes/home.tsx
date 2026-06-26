// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	CheckCircleIcon,
	EnvelopeIcon,
	InfoIcon,
	PlusIcon,
	TrashIcon,
	WarningCircleIcon,
	XCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import api from "~/services/api";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";
import type { SetupCheck, SetupStatus } from "~/types";

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

function SetupCheckIcon({ status }: { status: SetupCheck["status"] }) {
	if (status === "ok") {
		return <CheckCircleIcon size={16} weight="fill" className="text-current" />;
	}
	if (status === "error") {
		return <XCircleIcon size={16} weight="fill" className="text-current" />;
	}
	if (status === "warning") {
		return <WarningCircleIcon size={16} weight="fill" className="text-current" />;
	}
	return <InfoIcon size={16} weight="fill" className="text-current" />;
}

function SetupChecklist({ status }: { status?: SetupStatus }) {
	if (!status) return null;

	const title =
		status.status === "ready"
			? "Setup ready"
			: status.status === "needs_attention"
				? "Setup needs attention"
				: "Setup action required";

	return (
		<section className="refined-sketch-card mb-8 px-5 py-6 md:px-6">
			<div className="mb-5 flex items-start justify-between gap-3">
				<div>
					<h2 className="sketch-section-title">
						{title}
					</h2>
					<p className="mt-1 max-w-2xl text-sm leading-relaxed text-kumo-subtle">
						Deployment checks for receiving, sending, AI, storage, and access.
					</p>
				</div>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				{status.checks.map((check) => (
					<div
						key={check.id}
						className="sketch-check-card flex gap-3 px-4 py-3"
					>
						<span
							className={`sketch-status-dot sketch-status-${check.status} mt-0.5 shrink-0`}
						>
							<SetupCheckIcon status={check.status} />
						</span>
						<div className="min-w-0">
							<div className="truncate text-base font-semibold text-kumo-default">
								{check.label}
							</div>
							<div className="text-sm leading-snug text-kumo-subtle">
								{check.detail}
							</div>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const { data: mailboxes = [], refetch: refetchMailboxes, isFetched: mailboxesFetched } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const { data: setupStatus } = useQuery({
		queryKey: queryKeys.setup,
		queryFn: () => api.getSetupStatus(),
		staleTime: 30_000,
	});

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(
			mailboxes.map((m) => m.email.toLowerCase()),
		);
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => { if (!cancelled) refetchMailboxes(); });
		return () => { cancelled = true; };
	}, [emailAddresses, mailboxes, refetchMailboxes]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError("Please fill in all fields");
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: "Mailbox created successfully!" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to create mailbox";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "Mailbox deleted" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "Failed to delete mailbox", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const accounts = isConfigured
		? emailAddresses.map((addr) => ({
				id: addr,
				email: addr,
				name: addr.split("@")[0] || addr,
			}))
		: mailboxes;

	const isLoading = !configData;

	return (
		<div className="mailboxes-sketch-page">
			<div className="mailboxes-sketch-shell mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-16">
				<header className="mb-10">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0">
							<h1 className="mailboxes-sketch-title">Mailboxes</h1>
							{domains.length > 0 && (
								<p className="sketch-domain-label truncate">
									{domains.join(", ")}
								</p>
							)}
						</div>
						{!isConfigured && (
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								className="sketch-primary-button w-fit"
								onClick={() => setIsCreateOpen(true)}
							>
								New Mailbox
							</Button>
						)}
					</div>
				</header>

				<SetupChecklist status={setupStatus} />

				{isLoading ? (
					<div className="refined-sketch-card flex justify-center px-6 py-20">
						<Loader size="lg" />
					</div>
				) : accounts.length > 0 ? (
					<div className="sketch-mailbox-list">
						{accounts.map((account) => (
							<RouterLink
								key={account.id}
								to={`/mailbox/${account.id}`}
								className="sketch-mailbox-row group flex items-center gap-4 px-5 py-5 no-underline md:px-6"
							>
								<div className="sketch-avatar flex h-12 w-12 shrink-0 items-center justify-center">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-base font-semibold text-kumo-default">
										{account.name}
									</div>
									<div className="truncate text-sm text-kumo-subtle">
										{account.email}
									</div>
								</div>
								{!isConfigured && (
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<TrashIcon size={16} />}
										className="sketch-icon-button"
										aria-label={`Delete mailbox ${account.email}`}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToDelete({
												id: account.id,
												email: account.email,
											});
											setIsDeleteOpen(true);
										}}
									/>
								)}
							</RouterLink>
						))}
					</div>
				) : (
					<div className="sketch-empty-card px-6 py-16">
						<div className="flex flex-col items-center text-center">
							<div className="sketch-empty-icon mb-5 flex h-20 w-20 items-center justify-center">
								<EnvelopeIcon
									size={44}
									weight="thin"
									className="text-kumo-default"
								/>
							</div>
							<h3 className="sketch-section-title mb-2">
								No mailboxes yet
							</h3>
							<p className="mb-6 max-w-sm text-sm leading-relaxed text-kumo-subtle">
								{isConfigured
									? "Your email routing is configured but no mailboxes have been created yet. They will appear here automatically."
									: "Create a mailbox to start sending and receiving emails with your domain."}
							</p>
							{!isConfigured && (
								<Button
									variant="primary"
									icon={<PlusIcon size={16} />}
									className="sketch-primary-button"
									onClick={() => setIsCreateOpen(true)}
								>
									Create Mailbox
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="sketch-dialog p-6">
					<Dialog.Title className="sketch-section-title mb-5">
						Create New Mailbox
					</Dialog.Title>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<Text variant="error" size="sm">
								{createError}
							</Text>
						)}
						<div>
							<span className="text-sm font-medium text-kumo-default mb-1.5 block">
								Email Address
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label="Address prefix"
										placeholder="info"
										size="sm"
										value={newPrefix}
										onChange={(e) => setNewPrefix(e.target.value)}
										required
									/>
								</div>
								<span className="text-sm text-kumo-subtle">@</span>
								{domains.length > 1 ? (
									<div className="flex-1">
										<Select
											aria-label="Domain"
											value={selectedDomain}
											onValueChange={(value) => {
												if (value) setSelectedDomain(value);
											}}
										>
											{domains.map((d) => (
												<Select.Option key={d} value={d}>
													{d}
												</Select.Option>
											))}
										</Select>
									</div>
								) : (
									<span className="text-sm text-kumo-subtle">
										{selectedDomain || "no domain"}
									</span>
								)}
							</div>
						</div>
						<Input
							label="Display Name (optional)"
							placeholder="Info"
							size="sm"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								className="sketch-primary-button"
								loading={isCreating}
								disabled={!selectedDomain}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete Dialog */}
			<Dialog.Root
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<Dialog size="sm" className="sketch-dialog p-6">
					<Dialog.Title className="sketch-section-title mb-2">
						Delete Mailbox
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Are you sure you want to delete{" "}
						<strong className="text-kumo-default">
							{mailboxToDelete?.email}
						</strong>
						? This action cannot be undone.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isDeleting}
							onClick={handleDelete}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
