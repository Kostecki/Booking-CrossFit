import "@mantine/core/styles.css";
import {
	ColorSchemeScript,
	createTheme,
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getCurrentUser } from "#/server/auth.functions.ts";

const theme = createTheme({ primaryColor: "orange" });

export const Route = createRootRoute({
	beforeLoad: async () => ({ user: await getCurrentUser() }),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
			{ title: "CrossFit Booking" },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="da" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript defaultColorScheme="auto" />
				<HeadContent />
			</head>
			<body>
				<MantineProvider theme={theme} defaultColorScheme="auto">
					{children}
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
