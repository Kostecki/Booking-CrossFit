import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import {
	ColorSchemeScript,
	Loader,
	MantineProvider,
	mantineHtmlProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { getCurrentUser } from "#/server/auth.functions.ts";
import { INK, PAGE_BACKGROUND, theme } from "#/theme.ts";

// iOS launch images need a media query and PNG with matching pixel dimensions.
const startupScreens = [
	{ width: 320, height: 568, scale: 2 },
	{ width: 375, height: 667, scale: 2 },
	{ width: 414, height: 736, scale: 3 },
	{ width: 360, height: 780, scale: 3 },
	{ width: 375, height: 812, scale: 3 },
	{ width: 390, height: 844, scale: 3 },
	{ width: 393, height: 852, scale: 3 },
	{ width: 402, height: 874, scale: 3 },
	{ width: 414, height: 896, scale: 2 },
	{ width: 414, height: 896, scale: 3 },
	{ width: 428, height: 926, scale: 3 },
	{ width: 430, height: 932, scale: 3 },
	{ width: 420, height: 912, scale: 3 },
	{ width: 440, height: 956, scale: 3 },
];

export const Route = createRootRoute({
	beforeLoad: async () => ({ user: await getCurrentUser() }),
	pendingComponent: LaunchLoading,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				// No zooming, like a native app (also stops iOS zooming into inputs on focus).
				content:
					"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
			},
			{ title: "Auto CFR" },
			{ name: "theme-color", content: INK },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-title", content: "Auto CFR" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "default" },
		],
		links: [
			{ rel: "manifest", href: "/manifest.webmanifest?v=4" },
			{ rel: "icon", type: "image/png", href: "/favicon-574d42fb.png" },
			{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon-37f16848.png" },
			...startupScreens.map(({ width, height, scale }) => ({
				rel: "apple-touch-startup-image",
				href: `/startup/startup-${width * scale}x${height * scale}-auto-cfr.png`,
				media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait)`,
			})),
		],
	}),
	shellComponent: RootDocument,
});

function LaunchLoading() {
	return (
		<div
			role="status"
			style={{
				minHeight: "100dvh",
				backgroundColor: INK,
				color: "white",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: 24,
			}}
		>
			<img src="/icons/icon-512-93c124c5.png" alt="" width={144} height={144} />
			<h1 style={{ fontSize: 22, fontWeight: 600, margin: "24px 0 36px" }}>
				Auto CFR
			</h1>
			<Loader color="green" size="sm" aria-hidden="true" />
			<span style={{ fontSize: 14, marginTop: 12, color: "#d5d9e0" }}>
				Henter dine bookinger…
			</span>
		</div>
	);
}

function useServiceWorker() {
	useEffect(() => {
		if ("serviceWorker" in navigator) {
			navigator.serviceWorker.register("/sw.js").catch((error) => {
				console.error("Service worker registration failed", error);
			});
		}
	}, []);
}

// iOS ignores user-scalable=no; its proprietary gesture events are what pinch-zoom
// runs on, so cancelling them stops pinching. touch-action on <body> stops
// double-tap zoom.
function useNoPinchZoom() {
	useEffect(() => {
		const prevent = (event: Event) => event.preventDefault();
		for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
			document.addEventListener(type, prevent, { passive: false });
		}
		return () => {
			for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
				document.removeEventListener(type, prevent);
			}
		};
	}, []);
}

function RootDocument({ children }: { children: ReactNode }) {
	useServiceWorker();
	useNoPinchZoom();
	return (
		<html lang="da" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript forceColorScheme="light" />
				<HeadContent />
			</head>
			{/* Cards and the header stay white (Mantine's body colour); only the page behind them is tinted. */}
			<body
				style={{
					backgroundColor: PAGE_BACKGROUND,
					touchAction: "manipulation",
				}}
			>
				<MantineProvider theme={theme} forceColorScheme="light">
					<Notifications position="top-center" />
					{children}
				</MantineProvider>
				<Scripts />
			</body>
		</html>
	);
}
