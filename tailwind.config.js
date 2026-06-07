/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './**/*.{ts,tsx}',
  ],
  safelist: [
    // ── Arbitrary pixel sizes ──────────────────────────────────────
    { pattern: /text-\[(9|10|11|12|13|14|15|16|18|20)px\]/ },
    { pattern: /p[xytblr]?-\[(1|2|3|4|5|6|8|9|10|12|14|16|20|22)px\]/ },
    { pattern: /gap-\[(2|3|6|8|10)px\]/ },
    { pattern: /m[xytblr]?-\[(2|4|6|8|14)px\]/ },
    { pattern: /[wh]-\[(1|2|3|6|10|16|30)px\]/ },
    { pattern: /min-[wh]-\[(52|72|120)px\]/ },
    { pattern: /max-w-\[(600|860)px\]/ },
    { pattern: /rounded-\[(3|9|10|12)px\]/ },
    { pattern: /tracking-\[(-0\.5|0\.4|0\.5|0\.6|0\.8|1)px\]/ },
    { pattern: /leading-\[(1\.3|1\.4)\]/ },
    { pattern: /pt-\[(10)px\]/ },
    // ── Arbitrary CSS var utilities ────────────────────────────────
    { pattern: /bg-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /text-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /border-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /shadow-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /rounded-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /font-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /h-\[var\(--[a-z0-9-]+\)\]/ },
    { pattern: /w-\[var\(--[a-z0-9-]+\)\]/ },
    // ── Misc ───────────────────────────────────────────────────────
    'z-[2000]', 'z-[3000]', 'z-[9000]',
    'w-[min(300px,85vw)]',
    'flex-[0_0_var(--col-w)]',
    'flex-[0_0_220px]',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
