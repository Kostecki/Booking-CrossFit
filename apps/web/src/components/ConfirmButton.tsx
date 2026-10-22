import { Button, type ButtonProps, Group, Modal, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { type ReactNode, useState } from "react";

type Props = ButtonProps & {
	children: ReactNode;
	title: string;
	message: ReactNode;
	confirmLabel: string;
	onConfirm: () => Promise<unknown>;
};

/** A button that asks for confirmation in a modal before running `onConfirm`. */
export function ConfirmButton({
	children,
	title,
	message,
	confirmLabel,
	onConfirm,
	...buttonProps
}: Props) {
	const [opened, { open, close }] = useDisclosure(false);
	const [busy, setBusy] = useState(false);

	return (
		<>
			<Button {...buttonProps} onClick={open}>
				{children}
			</Button>
			<Modal opened={opened} onClose={close} title={title} centered>
				<Text size="sm">{message}</Text>
				<Group justify="flex-end" mt="lg">
					<Button variant="default" onClick={close}>
						Annuller
					</Button>
					<Button
						color={buttonProps.color}
						loading={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await onConfirm();
								close();
							} finally {
								setBusy(false);
							}
						}}
					>
						{confirmLabel}
					</Button>
				</Group>
			</Modal>
		</>
	);
}
