import { LOGO_SRC } from '../brand/logo';

/** Reserved space for the CoBuddy logo. Set LOGO_SRC in src/brand/logo.ts to fill it. */
export function LogoSlot({ size = 32 }: { size?: number }) {
  if (LOGO_SRC) {
    return <img className="logo-image" src={LOGO_SRC} alt="CoBuddy logo" style={{ height: size }} />;
  }
  return <span className="logo-slot" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Brand({ size = 32 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoSlot size={size} />
      <span className="brand-name">CoBuddy</span>
    </span>
  );
}
