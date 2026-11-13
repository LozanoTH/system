# AGENTS.md

This project uses the `apple-design` OpenCode skill for all interface work.

Before changing layout, styling, interaction, animation, gestures, drawers/sheets, modals, translucency, depth, typography, or accessibility behavior, load the `apple-design` skill and apply its guidance.

## Non-negotiable rules

- Feedback happens on pointer-down and continues during the interaction. Never animate only at completion.
- Direct manipulation tracks 1:1 and respects where the user grabbed the element.
- Motion is interruptible. Animate from the live on-screen value, never the logical target.
- Use springs for touchable, gesture-driven motion; avoid CSS transitions and keyframes for those cases.
- Default to critically damped springs (damping 1.0, response 0.3-0.4). Add bounce only when a gesture carried momentum.
- Pass release velocity into the settle animation.
- Project flick landing positions from velocity before snapping.
- Enter and exit along the same path; anchor overlays to their trigger.
- Use backdrop-filter layers for chrome that content scrolls under.
- Support prefers-reduced-motion, prefers-reduced-transparency, and prefers-contrast in every component.
- Prefer the platform system font unless there is a specific reason to override; tracking and leading must be size-specific.

The full skill is available as `apple-design`.
