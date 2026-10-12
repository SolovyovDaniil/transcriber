// Fluent UI v9 themes with one custom brand ramp (teal, hue 184).
// Contrast checked: white on brand70 = 5.47:1, brand100 on #292929 = 4.93:1.

import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-components";

const brand: BrandVariants = {
  10: "#05191A", 20: "#08292B", 30: "#0C383B", 40: "#11474B",
  50: "#15565B", 60: "#1B656A", 70: "#1F747A", 80: "#21858C",
  90: "#31949B", 100: "#3FA4AB", 110: "#55B3B9", 120: "#70BCC2",
  130: "#8DCACE", 140: "#A8D8DC", 150: "#C7E8EA", 160: "#E7F7F8",
};

const base = createLightTheme(brand);

export const lightTheme: Theme = {
  ...base,
  // Fluent puts primary buttons on brand80; white on it is 4.38:1, below AA. Shift one step darker.
  colorBrandBackground: brand[70],
  colorBrandBackgroundHover: brand[60],
  colorBrandBackgroundPressed: brand[40],
  colorBrandBackgroundSelected: brand[60],
  colorCompoundBrandBackground: brand[70],
  colorCompoundBrandBackgroundHover: brand[60],
  colorCompoundBrandBackgroundPressed: brand[50],
};

export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  colorBrandForeground1: brand[110],
  colorBrandForeground2: brand[120],
};

export const MONO = '"Cascadia Mono", Consolas, "SF Mono", monospace';
