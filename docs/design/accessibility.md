# Linkora Accessibility Guidelines

This document defines the accessibility standards all Linkora UI components must meet to ensure our platform is usable by everyone, regardless of ability or device.

---

## Focus States

**Requirement:** All interactive elements must have a visible, high-contrast focus state when navigated via keyboard.

**Applies to:**
- Buttons
- Links
- Form inputs
- Custom controls

**Implementation:**
- Use a 3px minimum outline width
- Maintain 3:1 contrast ratio between focus ring and background
- Ensure 4px minimum offset from element edge
- Apply focus style on `:focus-visible` (not `:focus`)

**Example CSS:**
```css
button:focus-visible {
  outline: 3px solid #0066cc;
  outline-offset: 4px;
}
```

---

## Color Contrast

**Requirement:** All text and interactive elements must meet WCAG AA contrast ratio minimums.

**Standards:**
- **Normal text** (< 18pt or < 14pt bold): 4.5:1 contrast ratio
- **Large text** (≥ 18pt or ≥ 14pt bold): 3:1 contrast ratio
- **Icon + text combinations:** Treat as text; apply normal or large text rules

**Testing:**
- Use WebAIM Contrast Checker or Axe DevTools for verification
- Audit all text/background color combinations before shipping
- Include contrast verification in design reviews

**Exceptions:**
- Logo and branding (no contrast requirement)
- Disabled form controls (reduced contrast acceptable if conveyed non-visually)

---

## ARIA Roles and Attributes

**Requirement:** Custom components must declare correct ARIA roles and maintain semantic HTML where possible.

**Custom Components:**

### Modal / Dialog
```html
<div role="dialog" aria-labelledby="modal-title" aria-modal="true">
  <h2 id="modal-title">Dialog Title</h2>
  <p>Content here</p>
  <button>Close</button>
</div>
```
- Trap focus within modal (Tab cycles through focusable elements only)
- Set `aria-modal="true"`
- Provide accessible close button

### Loading State
```html
<div role="status" aria-live="polite" aria-label="Loading content">
  <span>Loading...</span>
</div>
```
- Use `role="status"` for live notifications
- Set `aria-live="polite"` or `aria-live="assertive"` as appropriate
- Never hide from screen readers

### Tabs
```html
<div role="tablist">
  <button role="tab" aria-selected="true" aria-controls="panel-1">Tab 1</button>
  <button role="tab" aria-selected="false" aria-controls="panel-2">Tab 2</button>
</div>
<div id="panel-1" role="tabpanel" aria-labelledby="tab-1">Content</div>
```

### Toast Notifications
```html
<div role="alert" aria-live="assertive">
  Success: Your changes were saved.
</div>
```
- Use `role="alert"` for time-sensitive announcements
- Set `aria-live="assertive"` for immediate announcement

---

## Keyboard Navigation

**Requirement:** All functionality must be accessible via keyboard. No keyboard trap unless explicitly documented.

### Tab Order
- Tab through interactive elements in logical reading order (left-to-right, top-to-bottom)
- Use `tabindex="0"` only if needed for custom components
- Avoid positive `tabindex` values (breaks natural tab order)

### Common Key Bindings

| Key | Action |
|-----|--------|
| `Tab` | Move focus to next interactive element |
| `Shift+Tab` | Move focus to previous interactive element |
| `Enter` or `Space` | Activate button or checkbox |
| `Escape` | Close modal, dropdown, or menu |
| `Arrow Up / Down` | Navigate list items, menu items, or select options |
| `Home / End` | Jump to first/last item in a list or menu |

### Implementation
- All focusable elements must be reachable via Tab alone
- Custom widgets must implement arrow key navigation where standard
- Provide skip-to-content link (see below)

---

## Skip-to-Content Link

**Requirement:** Provide a keyboard-accessible skip link to allow users to bypass navigation.

**Implementation:**
```html
<a href="#main-content" class="skip-link">Skip to main content</a>

<nav><!-- Navigation here --></nav>

<main id="main-content">
  <!-- Primary page content -->
</main>
```

**CSS:**
```css
.skip-link {
  position: absolute;
  left: -9999px;
  z-index: 999;
}

.skip-link:focus {
  left: 0;
  top: 0;
  background: #0066cc;
  color: white;
  padding: 8px 16px;
}
```

- Hide visually by default
- Show on focus
- Place as first interactive element on the page

---

## Testing Checklist

Before shipping any component, verify:

- [ ] **Keyboard Navigation:** All functionality works with Tab, Enter, Escape, and Arrow keys
- [ ] **Focus Visible:** Focus state is visible and high-contrast on all interactive elements
- [ ] **Screen Reader:** Component announces correctly in NVDA (Windows), JAWS (Windows), or VoiceOver (macOS)
- [ ] **Color Contrast:** All text meets WCAG AA (4.5:1 for normal, 3:1 for large)
- [ ] **Resize Text:** Component remains usable when text is zoomed to 200%
- [ ] **No Flashing:** No element flashes more than 3 times per second (seizure risk)
- [ ] **ARIA Labels:** All interactive elements have descriptive labels or `aria-label`

---

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Axe DevTools Browser Extension](https://www.deque.com/axe/devtools/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

## Questions?

For clarification on these guidelines or accessibility concerns, open an issue or reach out to the team.
