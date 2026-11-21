import { Badge, Tooltip } from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import { useState } from "react";

export type ClassState = "booked" | "waitlist" | "planned" | "cancelled";

export const STATE_BADGE: Record<ClassState, { label: string; color: string }> =
	{
		booked: { label: "Booket", color: "green" },
		waitlist: { label: "Venteliste", color: "yellow" },
		planned: { label: "Planlagt", color: "gray" },
		cancelled: { label: "Afmeldt", color: "red" },
	};

/** The one pill a class gets, from its state plus skip/rebook/waiting-list details. */
export function classBadge(cls: {
	state?: ClassState;
	skipped: boolean;
	rebookPending: boolean;
	waitlistPosition?: number;
}): { label: string; color: string } | undefined {
	if (cls.skipped) return { label: "Springes over", color: "gray" };
	if (cls.state === "cancelled" && cls.rebookPending)
		return { label: "Genbookes", color: "blue" };
	if (cls.state === "waitlist" && cls.waitlistPosition)
		return { label: `Venteliste (#${cls.waitlistPosition})`, color: "yellow" };
	return cls.state ? STATE_BADGE[cls.state] : undefined;
}

// Badges whose meaning isn't obvious get a tooltip; touch opens it too, since phones can't hover.
const BADGE_HELP: Record<string, string> = {
	Afmeldt:
		"Du er afmeldt holdet. Det bookes ikke igen automatisk - tryk Genbook, hvis du vil booke igen.",
	Genbookes:
		"Bookes igen ved næste kørsel, eller når du trykker Book nu - hvis der er plads.",
	Ekstra: "Et hold uden for dine faste hold. Det bookes ikke igen automatisk.",
};

export function StatusBadge({
	label,
	color,
}: {
	label: string;
	color: string;
}) {
	const help = BADGE_HELP[label];
	if (!help) {
		return (
			<Badge size="sm" variant="light" color={color}>
				{label}
			</Badge>
		);
	}
	return <HelpBadge label={label} color={color} help={help} />;
}

// Controlled rather than Mantine's built-in events, which don't open on a tap: a tap
// toggles it and a tap elsewhere closes it; hover only reacts to a real mouse, since
// phones also fire pointerenter on tap, which would open and immediately re-close it.
function HelpBadge({
	label,
	color,
	help,
}: {
	label: string;
	color: string;
	help: string;
}) {
	const [opened, setOpened] = useState(false);
	const ref = useClickOutside(() => setOpened(false));
	return (
		<Tooltip label={help} opened={opened} multiline w={240} withArrow>
			<Badge
				ref={ref}
				size="sm"
				variant="light"
				color={color}
				style={{ cursor: "help" }}
				onClick={() => setOpened((o) => !o)}
				onPointerEnter={(e) => e.pointerType === "mouse" && setOpened(true)}
				onPointerLeave={(e) => e.pointerType === "mouse" && setOpened(false)}
			>
				{label}
			</Badge>
		</Tooltip>
	);
}
