/** Causal brand mark — concentric causal orbits. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" stroke="white" strokeWidth="1.5" opacity="0.9" />
      <circle cx="20" cy="20" r="11" stroke="white" strokeWidth="1" opacity="0.6" />
      <circle cx="20" cy="20" r="5" fill="white" opacity="0.8" />
      <path d="M20 2 L20 8" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M20 32 L20 38" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M2 20 L8 20" stroke="white" strokeWidth="1" opacity="0.4" />
      <path d="M32 20 L38 20" stroke="white" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}
