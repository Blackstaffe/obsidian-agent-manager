import * as React from "react";
const { useState, useRef, useEffect } = React;
import { setIcon } from "obsidian";
import type AgentManagerPlugin from "../../plugin";
import type { ManagedAgent } from "../../domain/models/managed-agent";

interface ChatMsg {
	id: string;
	role: "user" | "assistant" | "system";
	text: string;
	ts: number;
}

interface AgentRunChatProps {
	agent: ManagedAgent;
	plugin: AgentManagerPlugin;
}

function SendIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "send");
	}, []);
	return <span ref={ref} className="agent-run-chat-send-icon" />;
}

function PlayIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "play");
	}, []);
	return <span ref={ref} />;
}

function StopIcon() {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, "square");
	}, []);
	return <span ref={ref} />;
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function AgentRunChat({ agent }: AgentRunChatProps) {
	const [messages, setMessages] = useState<ChatMsg[]>([]);
	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	useEffect(() => {
		scrollToBottom();
	}, [messages]);

	// Reset chat when agent changes
	useEffect(() => {
		setMessages([]);
		setInput("");
		setRunning(false);
	}, [agent.id]);

	const send = () => {
		const text = input.trim();
		if (!text || running) return;

		const userMsg: ChatMsg = {
			id: crypto.randomUUID(),
			role: "user",
			text,
			ts: Date.now(),
		};
		setMessages((prev) => [...prev, userMsg]);
		setInput("");
		setRunning(true);

		// Placeholder response — to be wired to ACP in a future step
		setTimeout(() => {
			const reply: ChatMsg = {
				id: crypto.randomUUID(),
				role: "assistant",
				text: `Running agent "${agent.name}"…\n\nThis chat will be connected to the ACP session in a future update.`,
				ts: Date.now(),
			};
			setMessages((prev) => [...prev, reply]);
			setRunning(false);
		}, 800);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	};

	const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInput(e.target.value);
		// Auto-resize
		const el = e.target;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	};

	const isEmpty = messages.length === 0;

	return (
		<div className="agent-run-chat-container">
			{/* Header */}
			<div className="agent-run-chat-header">
				<span className="agent-run-chat-title">{agent.name}</span>
				<button
					className={`agent-run-chat-run-btn clickable-icon${running ? " is-running" : ""}`}
					aria-label={running ? "Stop agent" : "Run agent"}
					onClick={() => setRunning((v) => !v)}
				>
					{running ? <StopIcon /> : <PlayIcon />}
				</button>
			</div>

			{/* Messages */}
			<div className="agent-run-chat-messages">
				{isEmpty && (
					<div className="agent-run-chat-empty">
						<div className="agent-run-chat-empty-text">
							{agent.instructionsPath
								? `Instructions loaded from ${agent.instructionsPath}`
								: "No instructions set — configure in the settings pane."}
						</div>
						<div className="agent-run-chat-empty-hint">
							Send a message or press Run to start the agent.
						</div>
					</div>
				)}
				{messages.map((msg) => (
					<div
						key={msg.id}
						className={`agent-run-chat-msg agent-run-chat-msg--${msg.role}`}
					>
						<div className="agent-run-chat-msg-body">
							{msg.text.split("\n").map((line, i) => (
								<React.Fragment key={i}>
									{i > 0 && <br />}
									{line}
								</React.Fragment>
							))}
						</div>
						<div className="agent-run-chat-msg-ts">
							{formatTime(msg.ts)}
						</div>
					</div>
				))}
				{running && (
					<div className="agent-run-chat-msg agent-run-chat-msg--assistant">
						<div className="agent-run-chat-typing">
							<span /><span /><span />
						</div>
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="agent-run-chat-input-row">
				<textarea
					ref={textareaRef}
					className="agent-run-chat-input"
					placeholder="Send a message…"
					value={input}
					rows={1}
					onChange={handleInput}
					onKeyDown={handleKeyDown}
				/>
				<button
					className="agent-run-chat-send clickable-icon"
					aria-label="Send"
					disabled={!input.trim() || running}
					onClick={send}
				>
					<SendIcon />
				</button>
			</div>
		</div>
	);
}
