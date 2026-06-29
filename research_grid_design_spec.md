# Research Grid — UI Design Specification (for Claude / AI Code Generation)

> **Purpose**: Copy-paste this entire document (or relevant sections) into Claude (or any LLM) to generate a **pixel-perfect recreation** of the provided screenshot's **design only**.  
> **Strict instruction for generation**: Use **only design, layout, colors, typography, effects, spacing, and component structure**.  
> Replace **all financial/content text** with clean placeholder text (e.g. "Lorem ipsum dolor..." or short structured placeholders that match card length). Do **not** copy any real analysis text, numbers, or company-specific information.

---

## 1. Overall Aesthetic & Theme

- **Style**: Futuristic financial dashboard, dark cyber-neon / sci-fi premium terminal
- **Mood**: High-tech, professional, slightly cinematic
- **Primary palette**:
  - Background: Very dark navy/black `#0b0c12` – `#111218`
  - Main panels: Dark charcoal `#16181f` / `#1a1c24`
  - Accent 1 (neon/cyan glow): `#00f0ff` / `#00e5ff` (electric cyan)
  - Accent 2 (gold/premium): `#f4c95f` / `#ffd700` (warm gold)
  - Text primary: `#e8e8f0` (soft white)
  - Text secondary / muted: `#a0a8b8`
  - Card inner bg: `#0f1118`
- **Effects**: Heavy use of soft neon glows (`box-shadow` with cyan), subtle metallic gradients, rounded corners (10–14px), premium depth

---

## 2. Top-Level Layout (Vertical Stack)

```
┌────────────────────────────────────────────────────────────┐
│                    Research Grid  (gold title)             │
├────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐  │
│  │  CONTROL PANEL (large rounded card with cyan glow)   │  │
│  │  • Tickers input                                     │  │
│  │  • LLM Model pills                                   │  │
│  │  • Analyst Prompts pills                             │  │
│  │  • Run grid button + CSV/Excel exports               │  │
│  └──────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────┤
│  Search bar (full width, dark input with cyan focus glow)  │
├────────────────────────────────────────────────────────────┤
│  DATA GRID / TABLE                                       │
│  • Metallic header row                                   │
│  • Two ticker rows (NVDA + AAPL structure)               │
│  • Each content cell = dark "module card" with badge     │
│  • Special COMPARISON column treatment                   │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Title

- Text: **"Research Grid"**
- Font: Elegant modern sans-serif or slightly condensed (e.g. Inter, Satoshi, or system-ui with tracking)
- Color: Gold `#f4c95f` with subtle text-shadow / glow
- Size: Very large (≈ 42–48px)
- Position: Top-left or centered above the main panel
- Optional: Small sparkle/star icon next to title (matching the screenshot)

---

## 4. Main Control Panel (Top Card)

**Container**:
- Large rounded rectangle (border-radius: 14–16px)
- Dark background with subtle metallic gradient (top lighter, bottom darker)
- Strong cyan neon glow on the bottom edge + outer subtle glow
- Inner padding generous

**Internal sections** (top to bottom):

### 4.1 TICKERS
- Small uppercase label in gold/cyan: `TICKERS (COMMA-SEPARATED)`
- Large dark input field below it
  - Background: `#0a0b10`
  - Border: thin cyan `#00f0ff` or glowing
  - Value example (for layout only): `NVDA, AAPL,`
  - Height: tall / comfortable (≈ 48–52px)
  - Rounded corners matching panel

### 4.2 LLM MODEL
- Small uppercase label: `LLM MODEL`
- Horizontal row of **pill buttons** (height ≈ 36–40px)
- Buttons:
  - `DeepSeek ($)` → **active** (bright cyan background + strong glow)
  - `Claude ($$)` → inactive (dark fill + thin gold border)
  - `Gemini (Free)` → inactive (×2)
- Active state: cyan fill + cyan glow + white text
- Inactive: dark bg + gold border + muted text
- Gap between pills: small (8–12px)
- Hover: intensify glow / slight scale

### 4.3 ANALYST PROMPTS
- Small uppercase label: `ANALYST PROMPTS`
- Horizontal wrap/flex row of pill buttons
- Buttons (left to right):
  - Thesis, Moat, Catalysts, Risks, Valuation, Next Print → inactive style
  - **Comparison** → **active** (cyan glow) + small search/magnifier icon (🔍) on the left of text
- Same pill styling as LLM models

### 4.4 Bottom Action Row
- **Left side**:
  - Large glowing cyan button: `▶ Run grid`
  - Immediately to its right: `1315 DONE` in bright cyan text (smaller, bold)
- **Right side**:
  - Two subtle icon buttons: `CSV` and `Excel` with small download icon (⬇)
  - Darker, less prominent than Run button
  - Gold or muted cyan border

---

## 5. Search Bar

- Full-width dark input directly below control panel
- Background: `#111218` or slightly lighter than main bg
- Placeholder text (gray): `Search cells by ticker or content...`
- Left icon: subtle search icon
- On focus: cyan border + soft glow
- Height: ≈ 44–48px
- Rounded corners

---

## 6. Data Grid / Table (The Core Layout)

### 6.1 Table Header
- Background: Dark metallic gradient (brown-gold tones, e.g. `#3a2f1f` to `#2a2418`)
- Text: Uppercase, bold, gold/amber color `#e8d48a`
- Columns (exact order & widths feel):
  1. **TICKER** (narrow, fixed ~90–110px)
  2. **THESIS**
  3. **MOAT**
  4. **CATALYSTS**
  5. **RISKS**
  6. **VALUATION**
  7. **NEXT PRINT**
  8. **• COMPARISON** (note the small bullet/dot before the word)

- Clean column separation or very subtle borders
- Header height: comfortable (≈ 48–52px)

### 6.2 Table Body Rows

There are **two main rows** (one per ticker):

#### Row structure (per ticker)
- **Leftmost cell (TICKER column)**:
  - Dark background
  - Ticker symbol in **large bold cyan** (`NVDA`, `AAPL`)
  - Font size significantly larger than body text
  - Vertically centered
  - Optional small status indicator (dot or icon) below ticker

- **Content cells (THESIS → NEXT PRINT)** — each cell contains:
  - A **self-contained dark card/module**
    - Background: `#0f1118` or `#12141b`
    - Rounded corners (10–12px)
    - Subtle border or inner glow (very faint cyan)
    - Generous internal padding (12–16px)
  - **Top-left inside the card**: Small badge/label
    - Text: `RAG` or `FLAG` (tiny uppercase, cyan or blue)
    - Style: pill or rounded rectangle, very small font
  - Main area below badge: Multi-line text content area (use placeholder text of similar length/structure)
  - Text color: soft white `#e0e4f0`
  - Font size: small but readable (≈ 12–13.5px)
  - Line height: comfortable

#### Special COMPARISON column treatment
- Most cells in this column are empty or minimal
- In the bottom area of the COMPARISON column (spanning or in the last row area): 
  - A **glowing info card** with cyan border/glow
  - Positioned at the bottom-right of the entire table area
  - Contains a short explanatory note (use placeholder)
  - Style matches other cards but with stronger cyan accent

### 6.3 Row & Cell Details
- Ticker rows have subtle visual separation (thin horizontal line or slight background difference)
- All content cards should feel like "modules" sitting inside the table cells
- Consistent card height across columns for clean alignment (or natural height based on content)
- The entire table has a dark background that blends with the page

---

## 7. Interactive / State Notes (for code gen)

- LLM Model pills and Analyst Prompt pills should be **clickable** (JS toggle active state + cyan glow)
- `Run grid` button: on click show a temporary "Processing..." state with spinner or progress (fake)
- Cards in the grid: subtle hover lift + glow intensify
- Export buttons: simple click feedback
- Fully responsive down to tablet, but designed for wide desktop screens

---

## 8. Recommended Tech Stack for Claude (with Framer Motion)

For the most premium and smooth glow animations, use:

**React + Vite + Tailwind CSS + Framer Motion**

```bash
npm create vite@latest research-grid -- --template react
cd research-grid
npm install tailwindcss framer-motion lucide-react
npx tailwindcss init -p
```

### Key packages
- `framer-motion` — for spring-based glow intensity, scale, and pulse animations
- `lucide-react` — clean icons (Play, Download, Search, etc.)
- Tailwind for rapid layout & base styling

### Starter structure (App.jsx / main component)
```jsx
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Download, Search } from 'lucide-react';

function ResearchGrid() {
  // state for active LLM model, active prompts, processing, etc.
  return (
    <div className="min-h-screen bg-[#0b0c12] text-white p-8">
      {/* Title, Control Panel, Search, Table... */}
    </div>
  );
}
```

**Tailwind + Framer Motion custom styles** (add to `index.css` or a `styles.css`):

```css
.glow-cyan {
  box-shadow: 0 0 10px #00f0ff, 0 0 30px rgba(0, 240, 255, 0.35);
}

.glow-cyan-strong {
  box-shadow: 0 0 16px #00f0ff, 0 0 50px rgba(0, 240, 255, 0.5);
}

.glow-gold {
  box-shadow: 0 0 8px #f4c95f;
}

.metallic-header {
  background: linear-gradient(to bottom, #3a2f1f, #2a2418);
}

.card-module {
  background: #0f1118;
  border: 1px solid rgba(0, 240, 255, 0.12);
}
```

---

## 9. Exact Visual Checklist (verify against screenshot)

- [ ] Title gold with premium feel
- [ ] Main control panel has bright cyan bottom glow line
- [ ] Active LLM & Prompt buttons have strong cyan neon glow
- [ ] All pills have consistent height and rounded-full or high radius
- [ ] Content cards inside table have top-left small badge
- [ ] COMPARISON column has the special glowing note box at bottom
- [ ] Search bar sits cleanly between control panel and table
- [ ] Overall spacing is generous but not sparse
- [ ] No real data — only design + placeholders


## 10. Framer Motion Glow Animations (Recommended)

Use Framer Motion to bring the neon cyan glows to life with smooth, springy, and pulsing animations. This elevates the UI from static to premium sci-fi.

### 10.1 Active Pill Buttons (LLM Model & Analyst Prompts)
When a pill becomes active, animate the cyan glow intensity and a subtle scale.

```jsx
<motion.button
  whileHover={{ scale: 1.03 }}
  whileTap={{ scale: 0.98 }}
  animate={{
    boxShadow: isActive 
      ? "0 0 16px #00f0ff, 0 0 50px rgba(0, 240, 255, 0.5)" 
      : "0 0 4px rgba(0, 240, 255, 0.1)",
    backgroundColor: isActive ? "#00f0ff" : "#1a1c24",
    color: isActive ? "#000" : "#e8e8f0",
  }}
  transition={{ type: "spring", stiffness: 400, damping: 25 }}
  className="px-5 py-1.5 rounded-full text-sm font-medium border border-[#f4c95f]/60"
>
  DeepSeek ($)
</motion.button>
```

### 10.2 Hover Glow Intensify on Content Cards
Cards inside the table should gently lift and increase cyan glow on hover.

```jsx
<motion.div
  whileHover={{ 
    y: -3, 
    boxShadow: "0 0 14px #00f0ff, 0 0 35px rgba(0, 240, 255, 0.35)" 
  }}
  transition={{ type: "spring", stiffness: 300, damping: 20 }}
  className="card-module rounded-xl p-4"
>
  {/* RAG badge + content */}
</motion.div>
```

### 10.3 Run Grid Button – Processing Pulse
When clicked, the button should pulse with a stronger cyan glow + show loading state.

```jsx
<motion.button
  onClick={handleRunGrid}
  animate={isProcessing ? {
    boxShadow: [
      "0 0 12px #00f0ff, 0 0 40px rgba(0, 240, 255, 0.4)",
      "0 0 22px #00f0ff, 0 0 70px rgba(0, 240, 255, 0.6)",
      "0 0 12px #00f0ff, 0 0 40px rgba(0, 240, 255, 0.4)"
    ]
  } : {}}
  transition={isProcessing ? { 
    duration: 1.2, 
    repeat: Infinity, 
    ease: "easeInOut" 
  } : {}}
  className="flex items-center gap-2 px-8 py-3 bg-[#00f0ff] text-black font-semibold rounded-xl"
>
  <Play className="w-4 h-4" />
  {isProcessing ? "Processing..." : "Run grid"}
</motion.button>
```

### 10.4 Title Subtle Glow / Shine (Optional Cinematic Touch)
```jsx
<motion.h1
  animate={{ 
    textShadow: [
      "0 0 8px rgba(244, 201, 95, 0.4)",
      "0 0 18px rgba(244, 201, 95, 0.7)",
      "0 0 8px rgba(244, 201, 95, 0.4)"
    ] 
  }}
  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
  className="text-5xl font-semibold text-[#f4c95f]"
>
  Research Grid
</motion.h1>
```

### 10.5 Search Input Focus Glow
```jsx
<motion.input
  whileFocus={{ 
    boxShadow: "0 0 0 1px #00f0ff, 0 0 20px rgba(0, 240, 255, 0.25)" 
  }}
  className="w-full bg-[#111218] border border-white/10 rounded-xl px-4 py-3 
             placeholder:text-white/40 focus:outline-none"
/>
```

### Animation Principles to Follow
- Use **spring** physics (`type: "spring"`) for most button/card interactions — feels premium and responsive.
- Use **repeat + easeInOut** only for continuous pulses (Run button processing, title shine).
- Keep durations short (0.2s – 1.4s) so the interface feels snappy.
- Always combine with `whileHover` and `whileTap` for delightful micro-interactions.
- Disable animations on reduced-motion preference if desired (`prefers-reduced-motion`).

These animations make the cyan neon glow feel alive and expensive — exactly matching the cinematic quality of the original screenshot.


## 11. World-Class Design Elevations (My Recommendations)

These are premium upgrades I would add to turn this into a truly world-class interface — still faithful to the original screenshot’s dark neon aesthetic, but elevated with modern design systems thinking, better motion design, and delightful details.

### 11.1 Material & Depth System
- Apply **layered glassmorphism** on the main control panel and content cards:
  - Very subtle backdrop blur + semi-transparent layers
  - Inner highlight border (top-left) for a lifted material feel
- Add an extremely faint **noise texture** overlay on dark panels (using CSS `background-image` with low opacity noise PNG or SVG) — gives expensive terminal feel
- Improve metallic gradients with 3–4 color stops and better angle for the header row and panel top bar

### 11.2 Animation Orchestration (Framer Motion)
- **Staggered entrance**: Table rows and cards animate in with a small delay between each (creates beautiful "data loading" feel)
- **Shared Layout**: When switching active LLM model or Analyst Prompt, use `layout` prop so the active pill smoothly morphs position and size
- **Content card expand on click**: Clicking a card in the grid could gently expand it (with blur backdrop) to show full analysis — world-class research tools do this
- **Run button success state**: After "1315 DONE", briefly show a green/cyan success pulse + checkmark before resetting

Example staggered table rows:
```jsx
{models.map((model, i) => (
  <motion.div
    key={i}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: i * 0.03, type: "spring", stiffness: 120 }}
  >
    {/* row content */}
  </motion.div>
))}
```

### 11.3 Table & Grid Refinements
- Add a **subtle left accent bar** on row hover (cyan glow) for better row identification
- Make the **TICKER column sticky** on horizontal scroll (even if desktop-first)
- Improve visual hierarchy inside content cards:
  - Slightly larger, bolder first line of text
  - Better line-height and paragraph spacing
  - Truncation with elegant fade + "Read more" micro-interaction
- Column headers: Add very subtle **sort indicators** (even if not functional yet) — just for polish

### 11.4 Loading, Empty & Feedback States (Critical for World-Class)
- When clicking **Run grid**: 
  - Show beautiful skeleton cards in the grid with pulsing cyan glow
  - Animate the "1315 DONE" counter upward with Framer Motion `animate` count
- Empty state in COMPARISON column: Elegant centered illustration + message instead of blank space
- Success micro-interaction: Very subtle particle burst or confetti (3–4 cyan/gold dots) when analysis completes

### 11.5 Accessibility & Keyboard Delight
- Custom focus rings that match the cyan neon glow (not default browser)
- Full keyboard navigation between pills and table cells
- Add a subtle **⌘K / Ctrl+K** hint in the search bar for future command palette
- Respect `prefers-reduced-motion` globally (already in section 10)

### 11.6 Extra Premium Touches
- **Dynamic glow intensity**: The COMPARISON column cards could have slightly stronger / different hue glow because it’s the highlighted feature
- Background: Very subtle animated light rays or slow moving gradient (almost invisible) behind the whole dashboard
- Typography pairing: Use a high-quality sans (Inter / Satoshi) for body + a slightly more elegant display font for the main title
- Consistent 8px spacing rhythm throughout (makes everything feel intentional)

These elevations keep the original dark futuristic soul while making the interface feel like a $10k+ enterprise product.


---

**Ready to paste into Claude**:

> "Here is the complete design specification for the Research Grid interface from the screenshot. Generate a modern **React + Vite + Tailwind + Framer Motion** implementation.
>
> Base layer: Match the original screenshot layout, colors, neon cyan glows, gold accents, button styles, table structure, and card modules **exactly**.
>
> Enhancement layer: Incorporate the **World-Class Design Elevations** from section 11 (staggered animations, glassmorphism, skeleton states, row hover accents, success micro-interactions, better depth system, etc.). These should feel premium and intentional without breaking the original dark futuristic aesthetic.
>
> Use Framer Motion extensively for glows, active states, card hovers, processing pulse, and staggered entrances (follow examples in sections 10 and 11).
> Use placeholder text only — no real financial data.
> Make all interactive elements fully functional with proper React state.
> Prioritize world-class polish, motion design, and delightful micro-interactions."

---

*This spec was created strictly from visual analysis of the provided image. All content has been abstracted to design-only instructions.*