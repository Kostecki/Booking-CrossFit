import { Card, Divider, Stack, Text, UnstyledButton } from "@mantine/core";
import { Children, Fragment, type ReactNode } from "react";

import classes from "./Settings.module.css";

// iOS system colours for actions in settings lists.
const IOS_TINT = { action: "#007AFF", destructive: "#FF3B30" };

/** An iOS-style settings group: a small label, rows divided by hairlines, a footnote. */
export function SettingsGroup({
	label,
	footer,
	children,
}: {
	label: string;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const rows = Children.toArray(children);
	return (
		<Stack gap={6}>
			<Text size="xs" fw={600} c="dimmed" tt="uppercase" px="md">
				{label}
			</Text>
			<Card withBorder padding={0}>
				{rows.map((row, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are static per render
					<Fragment key={index}>
						{index > 0 && <Divider />}
						{row}
					</Fragment>
				))}
			</Card>
			{footer && (
				<Text size="xs" c="dimmed" px="md">
					{footer}
				</Text>
			)}
		</Stack>
	);
}

/**
 * A settings row: a label with an optional control on the right. With `onClick` the
 * whole row is a button in iOS's action blue (`tint="destructive"` for red). No chevron:
 * these rows act in place, they don't navigate.
 */
export function SettingsRow({
	label,
	right,
	tint,
	onClick,
	disabled,
}: {
	label: ReactNode;
	right?: ReactNode;
	tint?: keyof typeof IOS_TINT;
	onClick?: () => void;
	disabled?: boolean;
}) {
	const content = (
		<>
			<Text c={tint ? IOS_TINT[tint] : onClick ? IOS_TINT.action : undefined}>
				{label}
			</Text>
			{right}
		</>
	);
	if (!onClick) return <div className={classes.row}>{content}</div>;
	return (
		<UnstyledButton
			className={classes.row}
			data-clickable={disabled ? undefined : true}
			onClick={onClick}
			disabled={disabled}
		>
			{content}
		</UnstyledButton>
	);
}
