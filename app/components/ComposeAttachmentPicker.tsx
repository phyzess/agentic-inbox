// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { FileIcon, PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { formatBytes } from "~/lib/utils";
import type { ComposeAttachment } from "~/types";

interface ComposeAttachmentPickerProps {
	attachments: ComposeAttachment[];
	disabled?: boolean;
	isAdding?: boolean;
	onAddFiles: (files: FileList | null) => void;
	onRemove: (id: string) => void;
}

export default function ComposeAttachmentPicker({
	attachments,
	disabled,
	isAdding,
	onAddFiles,
	onRemove,
}: ComposeAttachmentPickerProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					icon={<PaperclipIcon size={14} />}
					onClick={() => inputRef.current?.click()}
					disabled={disabled}
					loading={isAdding}
				>
					Attach
				</Button>
				<input
					ref={inputRef}
					type="file"
					multiple
					className="hidden"
					onChange={(event) => {
						onAddFiles(event.currentTarget.files);
						event.currentTarget.value = "";
					}}
				/>
				{attachments.length > 0 && (
					<span className="text-xs text-kumo-subtle">
						{attachments.length} file{attachments.length === 1 ? "" : "s"}
					</span>
				)}
			</div>

			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{attachments.map((attachment) => (
						<div
							key={attachment.id}
							className="flex max-w-full items-center gap-2 rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm"
						>
							<FileIcon size={15} className="shrink-0 text-kumo-subtle" />
							<span className="max-w-[180px] truncate text-kumo-default">
								{attachment.filename}
							</span>
							<span className="shrink-0 text-xs text-kumo-subtle">
								{formatBytes(attachment.size)}
							</span>
							<Tooltip content="Remove attachment" asChild>
								<Button
									type="button"
									variant="ghost"
									shape="square"
									size="sm"
									icon={<XIcon size={13} />}
									onClick={() => onRemove(attachment.id)}
									disabled={disabled}
									aria-label={`Remove ${attachment.filename}`}
								/>
							</Tooltip>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
