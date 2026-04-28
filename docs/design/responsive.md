# Responsive Design System

## Breakpoints

Linkora uses a mobile-first responsive design approach with three primary breakpoints:

- **Mobile**: < 640px (default)
- **Tablet**: 640px - 1024px
- **Desktop**: > 1024px

### CSS Custom Properties

```css
--breakpoint-mobile: 640px;
--breakpoint-tablet: 1024px;
```

### Media Query Usage

```css
/* Mobile-first approach */
.component {
  /* Mobile styles (default) */
}

@media (min-width: 640px) {
  .component {
    /* Tablet styles */
  }
}

@media (min-width: 1024px) {
  .component {
    /* Desktop styles */
  }
}
```

## Layout Grid

### Column Structure

| Breakpoint | Columns | Gutter | Max Width |
| ---------- | ------- | ------ | --------- |
| Mobile     | 4       | 16px   | 100%      |
| Tablet     | 8       | 16px   | 768px     |
| Desktop    | 12      | 16px   | 1200px    |

### Grid Implementation

```css
.grid {
  display: grid;
  gap: var(--grid-gutter);
  grid-template-columns: repeat(var(--grid-columns-mobile), 1fr);
}

@media (min-width: 640px) {
  .grid {
    grid-template-columns: repeat(var(--grid-columns-tablet), 1fr);
  }
}

@media (min-width: 1024px) {
  .grid {
    grid-template-columns: repeat(var(--grid-columns-desktop), 1fr);
  }
}
```

## Navigation Patterns

### Desktop (> 1024px)

- Top horizontal navigation bar
- Persistent sidebar (optional)
- Full menu visibility

### Tablet (640px - 1024px)

- Top horizontal navigation bar
- Collapsible menu
- Optimized spacing

### Mobile (< 640px)

- Bottom tab bar for primary navigation
- Hamburger menu for secondary actions
- Sticky header with minimal controls

## Component Responsive Rules

### Post Card

**Mobile**

- Full width
- Stacked layout
- Touch-optimized buttons (min 44x44px)
- Larger tap targets

**Tablet**

- Max width: 600px
- Centered layout
- Same interaction patterns as mobile

**Desktop**

- Max width: 600px
- Hover states enabled
- Keyboard navigation support

### Profile Card

**Mobile**

- Horizontal layout
- Avatar: 48px
- Truncated text with ellipsis
- Follow button: min 44x44px

**Tablet/Desktop**

- Same as mobile with hover states
- Expanded text display

### Feed Layout

**Mobile**

- Single column
- Full-width cards
- Infinite scroll
- Pull-to-refresh

**Tablet**

- Single column
- Max width: 600px
- Centered content

**Desktop**

- Single column
- Max width: 600px
- Centered content
- Optional sidebar for filters

### Modals

**Mobile**

- Bottom sheet presentation
- Slides up from bottom
- Full width
- Swipe to dismiss

**Tablet/Desktop**

- Centered modal
- Max width: 500px
- Backdrop overlay
- Click outside to dismiss

## Touch Target Guidelines

All interactive elements must meet minimum touch target sizes for accessibility and usability:

- **Minimum size**: 44x44px (iOS) / 48x48px (Android)
- **Recommended**: 48x48px for all platforms
- **Spacing**: Minimum 8px between adjacent touch targets

### Implementation

```css
button,
a,
input[type="checkbox"],
input[type="radio"] {
  min-height: var(--min-touch-target); /* 44px */
  min-width: var(--min-touch-target);
}
```

### Examples

- Buttons: 44px height minimum
- Icon buttons: 44x44px minimum
- List items: 44px height minimum
- Form inputs: 44px height minimum

## Typography Scale

### Mobile

- H1: 1.75rem (28px)
- H2: 1.5rem (24px)
- H3: 1.25rem (20px)
- Body: 1rem (16px)
- Small: 0.875rem (14px)

### Desktop

- H1: 2.5rem (40px)
- H2: 2rem (32px)
- H3: 1.5rem (24px)
- Body: 1rem (16px)
- Small: 0.875rem (14px)

## Spacing System

Consistent spacing using CSS custom properties:

```css
--spacing-xs: 0.25rem; /* 4px */
--spacing-sm: 0.5rem; /* 8px */
--spacing-md: 1rem; /* 16px */
--spacing-lg: 1.5rem; /* 24px */
--spacing-xl: 2rem; /* 32px */
```

## Performance Considerations

### Mobile Optimization

- Lazy load images
- Infinite scroll with pagination
- Minimize bundle size
- Optimize for 3G networks

### Responsive Images

```html
<img
  src="image-mobile.jpg"
  srcset="
    image-mobile.jpg   640w,
    image-tablet.jpg  1024w,
    image-desktop.jpg 1920w
  "
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 768px, 1200px"
  alt="Description"
/>
```

## Testing Checklist

- [ ] Test on physical devices (iOS and Android)
- [ ] Test all breakpoints in browser dev tools
- [ ] Verify touch target sizes
- [ ] Test landscape and portrait orientations
- [ ] Verify text readability at all sizes
- [ ] Test with browser zoom (up to 200%)
- [ ] Verify keyboard navigation
- [ ] Test with screen readers

## Browser Support

- Chrome/Edge: Last 2 versions
- Firefox: Last 2 versions
- Safari: Last 2 versions
- iOS Safari: iOS 14+
- Chrome Android: Last 2 versions
