# Selection marquee added to the overlay grammar

`docs/STYLEGUIDE.md` now specifies the drag-box for area tools: screen-space,
1px gold border over a `ground` keyline, `rgba(220,162,60,0.10)` fill,
square corners, solid lines — never dashed or animated. Written ahead of the
first implementation (chop drag-designation) so future area tools (walls,
cancel-areas) copy it instead of inventing their own.
