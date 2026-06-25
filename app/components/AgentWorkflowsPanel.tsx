// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader } from "@cloudflare/kumo";
import {
	ArrowRightIcon,
	CheckCircleIcon,
	FileTextIcon,
	GearSixIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import { getSnippetText } from "~/lib/utils";
import { useEmails } from "~/queries/emails";
import {
	useConfirmRule,
	useDisableRule,
	useRules,
	useTriageActivity,
	useTriageStatus,
} from "~/queries/labels";
import { useUIStore } from "~/hooks/useUIStore";

function EmptyWorkState({ text }: { text: string }) {
	return (
		<div className="rounded-lg border border-dashed border-kumo-line px-3 py-4 text-center text-xs text-kumo-subtle">
			{text}
		</div>
	);
}

export default function AgentWorkflowsPanel() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const { selectEmail } = useUIStore();
	const { data: draftData, isLoading: draftsLoading } = useEmails(mailboxId, {
		folder: Folders.DRAFT,
		page: "1",
		limit: "5",
	});
	const { data: rules = [] } = useRules(mailboxId);
	const { data: triageStatus } = useTriageStatus(mailboxId);
	const { data: activity = [] } = useTriageActivity(mailboxId);
	const confirmRule = useConfirmRule();
	const disableRule = useDisableRule();

	const drafts = draftData?.emails ?? [];
	const suggestedRules = rules.filter((rule) => rule.status === "suggested").slice(0, 4);
	const recentActivity = activity.slice(0, 4);

	const openDraft = (id: string) => {
		if (!mailboxId) return;
		navigate(`/mailbox/${mailboxId}/review-drafts`);
		selectEmail(id);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-kumo-line px-4 py-3">
				<div className="flex items-center gap-2">
					<RobotIcon size={16} weight="duotone" className="text-kumo-brand" />
					<div>
						<div className="text-sm font-semibold text-kumo-default">
							Agent work
						</div>
						<div className="text-xs text-kumo-subtle">
							Drafts, rules, triage, and recent actions
						</div>
					</div>
				</div>
			</div>

			<div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
				<section className="space-y-2">
					<div className="flex items-center justify-between">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">
							Drafts to review
						</h3>
						<Button
							variant="ghost"
							size="xs"
							icon={<ArrowRightIcon size={12} />}
							onClick={() => mailboxId && navigate(`/mailbox/${mailboxId}/review-drafts`)}
						>
							Open
						</Button>
					</div>
					{draftsLoading ? (
						<div className="flex justify-center py-4">
							<Loader size="sm" />
						</div>
					) : drafts.length === 0 ? (
						<EmptyWorkState text="No drafts are waiting for approval." />
					) : (
						<div className="space-y-2">
							{drafts.map((draft) => (
								<button
									key={draft.id}
									type="button"
									onClick={() => openDraft(draft.id)}
									className="w-full rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-left transition-colors hover:bg-kumo-tint"
								>
									<div className="flex items-center gap-2">
										<FileTextIcon size={14} className="shrink-0 text-kumo-subtle" />
										<span className="min-w-0 flex-1 truncate text-xs font-medium text-kumo-default">
											{draft.subject || "(No subject)"}
										</span>
										<span className="shrink-0 text-[11px] text-kumo-subtle">
											{formatListDate(draft.date)}
										</span>
									</div>
									<div className="mt-1 truncate text-xs text-kumo-subtle">
										{draft.recipient || "No recipient"}
										{draft.snippet ? ` - ${getSnippetText(draft.snippet)}` : ""}
									</div>
								</button>
							))}
						</div>
					)}
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">
						Triage health
					</h3>
					<div className="grid grid-cols-2 gap-2">
						<div className="rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="text-[11px] uppercase text-kumo-subtle">
								Failed
							</div>
							<div className="text-lg font-semibold text-kumo-default">
								{triageStatus?.error ?? "-"}
							</div>
						</div>
						<div className="rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2">
							<div className="text-[11px] uppercase text-kumo-subtle">
								Unclassified
							</div>
							<div className="text-lg font-semibold text-kumo-default">
								{triageStatus?.unclassified ?? "-"}
							</div>
						</div>
					</div>
					<Button
						variant="secondary"
						size="sm"
						icon={<GearSixIcon size={14} />}
						onClick={() => mailboxId && navigate(`/mailbox/${mailboxId}/settings`)}
						className="w-full"
					>
						Open triage settings
					</Button>
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">
						Suggested rules
					</h3>
					{suggestedRules.length === 0 ? (
						<EmptyWorkState text="No suggested rules need review." />
					) : (
						<div className="space-y-2">
							{suggestedRules.map((rule) => (
								<div
									key={rule.id}
									className="rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2"
								>
									<div className="flex items-center gap-2">
										<Badge variant="secondary">
											{rule.label_name ?? rule.label_id}
										</Badge>
										<span className="min-w-0 flex-1 truncate text-xs text-kumo-subtle">
											{rule.field} {rule.operator} {rule.value}
										</span>
									</div>
									<div className="mt-2 flex gap-2">
										<Button
											variant="primary"
											size="xs"
											onClick={() =>
												mailboxId &&
												confirmRule.mutate({ mailboxId, ruleId: rule.id })
											}
											loading={confirmRule.isPending}
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
											loading={disableRule.isPending}
										>
											Disable
										</Button>
									</div>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-kumo-subtle">
						Recent activity
					</h3>
					{recentActivity.length === 0 ? (
						<EmptyWorkState text="No automated activity recorded yet." />
					) : (
						<div className="space-y-2">
							{recentActivity.map((event) => (
								<div
									key={event.id}
									className="rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2"
								>
									<div className="flex items-center gap-2">
										<CheckCircleIcon size={14} className="shrink-0 text-kumo-success" />
										<span className="min-w-0 flex-1 truncate text-xs font-medium text-kumo-default">
											{event.subject || "(No subject)"}
										</span>
									</div>
									<div className="mt-1 truncate text-xs text-kumo-subtle">
										{event.source.replaceAll("_", " ")}
										{event.labelName ? ` - ${event.labelName}` : ""}
									</div>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
