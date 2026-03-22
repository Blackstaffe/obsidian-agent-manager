import * as React from "react";
const { useRef, useEffect, useImperativeHandle, forwardRef } = React;
import { setIcon } from "obsidian";

interface HeaderButtonProps {
	iconName: string;
	tooltip: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	disabled?: boolean;
}

export const HeaderButton = forwardRef<HTMLButtonElement, HeaderButtonProps>(
	function HeaderButton({ iconName, tooltip, onClick, disabled }, ref) {
		const buttonRef = useRef<HTMLButtonElement>(null);

		// Expose the button ref to parent components
		useImperativeHandle(ref, () => buttonRef.current!, []);

		useEffect(() => {
			if (buttonRef.current) {
				setIcon(buttonRef.current, iconName);
			}
		}, [iconName]);

		return (
			<button
				ref={buttonRef}
				title={tooltip}
				onClick={onClick}
				disabled={disabled}
				className={`agent-manager-header-button${disabled ? " is-disabled" : ""}`}
			/>
		);
	},
);
