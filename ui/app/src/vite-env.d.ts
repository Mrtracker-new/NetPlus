// Side-effect stylesheet imports (the design system) carry no types — declare
// them so `tsc --noEmit` accepts `import "@netpulse/design-system/styles.css"`.
declare module "*.css";
