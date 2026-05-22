// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { ClassificationRule, Label, TriageStatus } from "~/types";
import { queryKeys } from "./keys";

function invalidateTriage(qc: ReturnType<typeof useQueryClient>, mailboxId: string) {
	qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
	qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	qc.invalidateQueries({ queryKey: queryKeys.labels.list(mailboxId) });
	qc.invalidateQueries({ queryKey: queryKeys.rules.list(mailboxId) });
	qc.invalidateQueries({ queryKey: queryKeys.triage.status(mailboxId) });
}

export function useLabels(mailboxId: string | undefined) {
	return useQuery<Label[]>({
		queryKey: mailboxId ? queryKeys.labels.list(mailboxId) : ["labels", "_disabled"],
		queryFn: () => api.listLabels(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useRules(mailboxId: string | undefined) {
	return useQuery<ClassificationRule[]>({
		queryKey: mailboxId ? queryKeys.rules.list(mailboxId) : ["rules", "_disabled"],
		queryFn: () => api.listRules(mailboxId!),
		enabled: !!mailboxId,
	});
}

export function useTriageStatus(mailboxId: string | undefined) {
	return useQuery<TriageStatus>({
		queryKey: mailboxId ? queryKeys.triage.status(mailboxId) : ["triage", "_disabled", "status"],
		queryFn: () => api.getTriageStatus(mailboxId!),
		enabled: !!mailboxId,
		refetchInterval: 5_000,
	});
}

export function useClassifyEmail() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			force,
		}: { mailboxId: string; emailId: string; force?: boolean }) =>
			api.classifyEmail(mailboxId, emailId, force ?? true),
		onSuccess: (_data, { mailboxId }) => invalidateTriage(qc, mailboxId),
	});
}

export function useApplyLabel() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			labelId,
			reason,
		}: { mailboxId: string; emailId: string; labelId: string; reason?: string }) =>
			api.applyLabel(mailboxId, emailId, labelId, reason),
		onSuccess: (_data, { mailboxId }) => invalidateTriage(qc, mailboxId),
	});
}

export function useConfirmRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			ruleId,
		}: { mailboxId: string; ruleId: string }) =>
			api.confirmRule(mailboxId, ruleId),
		onSuccess: (_data, { mailboxId }) => invalidateTriage(qc, mailboxId),
	});
}

export function useDisableRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			ruleId,
		}: { mailboxId: string; ruleId: string }) =>
			api.disableRule(mailboxId, ruleId),
		onSuccess: (_data, { mailboxId }) => invalidateTriage(qc, mailboxId),
	});
}

export function useBackfillTriage() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			folder,
			limit,
			page,
			force,
		}: {
			mailboxId: string;
			folder?: string;
			limit?: number;
			page?: number;
			force?: boolean;
		}) => api.backfillTriage(mailboxId, { folder, limit, page, force }),
		onSuccess: (_data, { mailboxId }) => invalidateTriage(qc, mailboxId),
	});
}
