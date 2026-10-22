import {
	Chip,
	createTheme,
	type MantineColorsTuple,
	Switch,
} from "@mantine/core";

// CrossFit Roskilde's colours: ink for buttons, links, text and icons; green for
// accents (its lightest tint, #f6faf3, only in small spots). The page itself is a
// neutral off-white so the green doesn't take over.
export const INK = "#161c24";
export const GREEN = "#61a928";
export const PAGE_BACKGROUND = "#f8f9fa";

// Both palettes have the brand colour at index 6, which is the primary shade.
const ink: MantineColorsTuple = [
	"#eef0f3",
	"#d5d9e0",
	"#aeb5c1",
	"#868fa0",
	"#636d80",
	"#424b5c",
	INK,
	"#12171e",
	"#0e1218",
	"#0a0d11",
];

const green: MantineColorsTuple = [
	"#f6faf3",
	"#e8f4de",
	"#d0e8bc",
	"#b5da95",
	"#9bcd72",
	"#7fbc4c",
	GREEN,
	"#559522",
	"#49801d",
	"#3c6a17",
];

export const theme = createTheme({
	colors: { ink, green },
	primaryColor: "ink",
	primaryShade: 6,
	black: INK,
	components: {
		Switch: Switch.extend({ defaultProps: { color: "green" } }),
		Chip: Chip.extend({ defaultProps: { color: "green" } }),
	},
});
