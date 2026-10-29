export default function BrandMark({ size = 36 }) {
  return (
    <div className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M3 17l5.5-7.5 4 4L21 5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19.5" cy="5.5" r="2.3" fill="#fbbf24" />
      </svg>
    </div>
  );
}
