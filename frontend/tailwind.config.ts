import type { Config } from "tailwindcss";

// Legacy breakpoint names remain available while pages migrate to Base Nova.
export default {
  theme: {
    extend: {
      screens: {
        phone: "370px",
        tablet: "750px",
        laptop: "1000px",
        desktop: "1200px",
      },
      colors: {
        "chart-1": "hsl(var(--chart-1))",
        "chart-2": "hsl(var(--chart-2))",
        "chart-3": "hsl(var(--chart-3))",
        "chart-4": "hsl(var(--chart-4))",
        "chart-5": "hsl(var(--chart-5))",
      },
    },
  },
} satisfies Config;
