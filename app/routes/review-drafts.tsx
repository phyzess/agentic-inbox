// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	FileTextIcon,
	PaperPlaneTiltIcon,
	RobotIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import MailboxSplitView from "~/components/MailboxSplitView";
import { getSnippetText } from "~/lib/utils";
import { useDeleteEmail, useEmails } from "~/queries/emails";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

const REVIEW_LIMIT = 50;

export default function ReviewDraftsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { selectedEmailId, isComposing, selectEmail } = useUIStore();
	const deleteEmail = useDeleteEmail();
	const { data, isLoading, isFetching } = useEmails(mailboxId, {
		folder: Folders.DRAFT,
		page: "1",
		limit: String(REVIEW_LIMIT),
	});
	const drafts = data?.emails ?? [];
	const totalCount = data?.totalCount ?? 0;

	const discardDraft = (draft: Email) => {
		if (!mailboxId) return;
		if (!window.confirm("Discard this draft?")) return;
		deleteEmail.mutate(
			{ mailboxId, id: draft.id },
			{
				onSuccess: () => {
					toastManager.add({ title: "Draft discarded" });
					if (selectedEmailId === draft.id) selectEmail(null);
				},
				onError: () =>
					toastManager.add({
						title: "Failed to discard draft",
						variant: "error",
					}),
			},
		);
	};

	return (
		<MailboxSplitView selectedEmailId={selectedEmailId} isComposing={isComposing}>
			<div className="flex h-full flex-col">
				<div className="list-header shrink-0 px-4 py-3.5 md:px-5">
					<div className="flex items-center gap-3">
						<div className="sketch-bubble flex h-8 w-8 shrink-0 items-center justify-center text-kumo-brand">
							<RobotIcon size={18} weight="duotone" />
						</div>
						<div className="min-w-0 flex-1">
							<h1 className="truncate text-lg font-bold text-kumo-default">
								Draft review
							</h1>
							<p className="truncate text-sm text-kumo-subtle">
								{totalCount} draft{totalCount === 1 ? "" : "s"} waiting for approval
							</p>
						</div>
						{isFetching && <Loader size="sm" />}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="flex justify-center py-16">
							<Loader size="lg" />
						</div>
					) : drafts.length === 0 ? (
						<div className="flex flex-col items-center justify-center px-6 py-24 text-center">
							<div className="sketch-note max-w-sm px-7 py-8">
								<FileTextIcon size={44} weight="thin" className="mx-auto mb-4 text-kumo-subtle" />
								<h3 className="mb-1.5 text-base font-bold text-kumo-default">
									No drafts to review
								</h3>
								<p className="text-sm text-kumo-subtle">
									AI-generated and manually saved drafts will appear here before anything is sent.
								</p>
							</div>
						</div>
					) : (
						<div>
							{drafts.map((draft) => {
								const isSelected = selectedEmailId === draft.id;
								const snippet = getSnippetText(draft.snippet);
								return (
									<div
										key={draft.id}
										role="button"
										tabIndex={0}
										onClick={() => selectEmail(draft.id)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												selectEmail(draft.id);
											}
										}}
										className={`mail-row group flex cursor-pointer items-center gap-3 px-4 py-3 text-left md:px-5 ${
											isSelected ? "mail-row-active" : ""
										}`}
									>
										<div className="sketch-bubble flex h-8 w-8 shrink-0 items-center justify-center text-kumo-subtle">
											<PaperPlaneTiltIcon size={16} />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span className="truncate text-sm font-semibold text-kumo-default">
													{draft.recipient || "No recipient"}
												</span>
												<Badge variant="secondary">Draft</Badge>
												<span className="ml-auto shrink-0 text-sm text-kumo-subtle">
													{formatListDate(draft.date)}
												</span>
											</div>
											<div className="mt-0.5 truncate text-sm">
												<span className="font-medium text-kumo-default">
													{draft.subject || "(No subject)"}
												</span>
												{snippet && (
													<span className="font-normal text-kumo-subtle">
														{" "}&mdash; {snippet}
													</span>
												)}
											</div>
										</div>
										<Tooltip content="Discard draft" asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={<TrashIcon size={16} />}
												onClick={(event) => {
													event.stopPropagation();
													discardDraft(draft);
												}}
												loading={deleteEmail.isPending}
												aria-label="Discard draft"
												className="opacity-100 md:opacity-0 md:group-hover:opacity-100"
											/>
										</Tooltip>
									</div>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</MailboxSplitView>
	);
}
