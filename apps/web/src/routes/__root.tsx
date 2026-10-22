import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
	ColorSchemeScript,
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { getCurrentUser } from "#/server/auth.functions.ts";
import { INK, PAGE_BACKGROUND, theme } from "#/theme.ts";

export const Route = createRootRoute({
	beforeLoad: async () => ({ user: await getCurrentUser() }),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ title: "CrossFit Booking" },
			{ name: "theme-color", content: INK },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-title", content: "Booking" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "default" },
		],
		links: [
			{ rel: "manifest", href: "/manifest.webmanifest" },
			{ rel: "icon", type: "image/png", href: "/favicon.png" },
			{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
		],
	}),
	shellComponent: RootDocument,
});

function useServiceWorker() {
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch((error) => {
				console.error("Service worker registration failed", error);
			});
		}
	}, []);
}

function RootDocument({ children }: { children: ReactNode }) {
	useServiceWorker();
	return (
		<html lang="da" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript forceColorScheme="light" />
				<HeadContent />
			</head>
			{/* Cards and the header stay white (Mantine's body colour); only the page behind them is tinted. */}
			<body style={{ backgroundColor: PAGE_BACKGROUND }}>
				<MantineProvider theme={theme} forceColorScheme="light">
					<Notifications position="top-center" />
					{children}
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
