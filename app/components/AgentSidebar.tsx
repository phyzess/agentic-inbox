// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader } from "@cloudflare/kumo";
import { CheckCircleIcon, PlugsIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import AgentWorkflowsPanel from "./AgentWorkflowsPanel";
import MCPPanel from "./MCPPanel";

function LazyAgentPanel() {
	const [AgentChat, setAgentChat] = useState<React.ComponentType | null>(
		null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		import("~/components/AgentPanel").then((mod) => {
			setAgentChat(() => mod.default);
		}).catch((err) => {
			console.error("Failed to load AgentPanel:", err);
			setLoadError("Failed to load agent panel");
		});
	}, []);

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-full">
				<span className="text-xs text-kumo-error">{loadError}</span>
			</div>
		);
	}
	if (!AgentChat) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader size="base" />
				<span className="text-xs text-kumo-subtle">Loading agent...</span>
			</div>
		);
	}
	return <AgentChat />;
}

export default function AgentSidebar() {
	const [activeTab, setActiveTab] = useState<"agent" | "work" | "mcp">("agent");

	return (
		<div className="flex flex-col h-full bg-kumo-base">
			{/* Tab bar */}
			<div className="agent-tabs flex items-center border-b border-kumo-line shrink-0">
				<button
					type="button"
					onClick={() => setActiveTab("agent")}
					className={`agent-tab flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-transparent cursor-pointer ${
						activeTab === "agent"
							? "agent-tab-active"
							: ""
					}`}
				>
					<RobotIcon size={14} weight={activeTab === "agent" ? "fill" : "regular"} />
					Agent
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("work")}
					className={`agent-tab flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-transparent cursor-pointer ${
						activeTab === "work"
							? "agent-tab-active"
							: ""
					}`}
				>
					<CheckCircleIcon size={14} weight={activeTab === "work" ? "fill" : "regular"} />
					Work
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("mcp")}
					className={`agent-tab flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-transparent cursor-pointer ${
						activeTab === "mcp"
							? "agent-tab-active"
							: ""
					}`}
				>
					<PlugsIcon size={14} weight={activeTab === "mcp" ? "fill" : "regular"} />
					MCP
				</button>
			</div>

			{/* Tab content — keep agent mounted so chat isn't lost */}
			<div className="flex-1 min-h-0 overflow-hidden">
				<div className={activeTab === "agent" ? "h-full" : "hidden"}>
					<LazyAgentPanel />
				</div>
				{activeTab === "work" && <AgentWorkflowsPanel />}
				{activeTab === "mcp" && <MCPPanel />}
			</div>
		</div>
	);
}
