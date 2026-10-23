import { notifications } from "@mantine/notifications";

export const notifyError = (error: unknown) =>
	notifications.show({
		color: "red",
		title: "Noget gik galt",
		message: error instanceof Error ? error.message : String(error),
	});

export const notifyInfo = (message: string) => notifications.show({ message });
