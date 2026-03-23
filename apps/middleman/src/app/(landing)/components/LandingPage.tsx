"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTheme } from "next-themes";
import { PocketLogoWhite, PocketLogoBlack } from "@igniter/ui/assets";
import "../landing.css";

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const { resolvedTheme } = useTheme();

  // Particle system
  const initParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Respect prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Cancel any existing animation
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const isDark = resolvedTheme === "dark";
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const count = Math.min(60, Math.floor((w * h) / 25000));
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      opacity: number;
    }[] = [];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.3 + 0.1,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const color = isDark ? "230, 237, 245" : "23, 28, 31";

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${color}, ${p.opacity})`;
        ctx!.fill();
      });

      // Faint connecting lines
      for (let i = 0; i < particles.length; i++) {
        const pi = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const pj = particles[j];
          if (!pi || !pj) continue;
          const dx = pi.x - pj.x;
          const dy = pi.y - pj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx!.beginPath();
            ctx!.moveTo(pi.x, pi.y);
            ctx!.lineTo(pj.x, pj.y);
            ctx!.strokeStyle = `rgba(${color}, ${0.04 * (1 - dist / 120)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    draw();

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [resolvedTheme]);

  // Init particles on mount and theme change
  useEffect(() => {
    const cleanup = initParticles();
    return () => cleanup?.();
  }, [initParticles]);

  // Connect Wallet handler: trigger the navbar's WalletPicker dialog
  const handleConnectWallet = () => {
    // Find the navbar's "Connect Wallet" button and click it
    const navbarBtn = document.querySelector<HTMLButtonElement>(
      'header button[data-slot="trigger"], header button'
    );
    // Fall back to any button that says "Connect Wallet"
    if (navbarBtn) {
      navbarBtn.click();
      return;
    }
    const allButtons = document.querySelectorAll("button");
    for (const btn of allButtons) {
      if (btn.textContent?.trim() === "Connect Wallet") {
        btn.click();
        return;
      }
    }
  };

  return (
    <>
      {/* ===== Background Layers ===== */}
      <canvas id="particles-canvas" ref={canvasRef} />
      <div className="bg-canvas">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>
      <div className="landing-dot-grid" />

      {/* ===== Page Content ===== */}
      <div className="landing-wrapper">
        {/* Hero */}
        <section className="landing-hero">
          <div className="hero-badge">
            <span className="pulse" />
            Powered by Pocket Network
          </div>

          <h1>
            Non-Custodial Staking
            <br />
            for <span className="highlight">$POKT</span>
          </h1>

          <p className="hero-sub">
            Stake across multiple providers without giving up custody of your
            tokens. Igniter handles the infrastructure so you keep full control.
          </p>

          <div className="hero-actions">
            <button
              className="hero-btn hero-btn-primary"
              onClick={handleConnectWallet}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{ marginRight: 4 }}
              >
                <rect
                  x="2"
                  y="4"
                  width="12"
                  height="9"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M4 4V3a2 2 0 012-2h4a2 2 0 012 2v1"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <circle cx="10.5" cy="8.5" r="1" fill="currentColor" />
              </svg>
              Connect Wallet &amp; Stake
            </button>
            <a
              href="https://docs.pocket.network"
              className="hero-btn hero-btn-outline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the Docs
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                style={{ marginLeft: 2, opacity: 0.5 }}
              >
                <path
                  d="M3.5 8.5l5-5M4 3.5h5v5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </a>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="features-section">
          <div className="features-grid">
            <div
              className="feature-card"
            >
              <div className="feature-icon blue">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 2L3 6v8l7 4 7-4V6l-7-4z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M10 10v8M3 6l7 4 7-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
              <h3>Non-Custodial by Design</h3>
              <p>
                Your tokens never leave your wallet. Igniter coordinates staking
                directly on-chain — no intermediary holds your funds at any
                point.
              </p>
            </div>

            <div
              className="feature-card"
            >
              <div className="feature-icon gold">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle
                    cx="10"
                    cy="10"
                    r="7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M10 6v4l3 2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3>Multi-Provider Staking</h3>
              <p>
                Distribute your stake across multiple infrastructure providers.
                Diversify risk and support the network&apos;s decentralization
                in one interface.
              </p>
            </div>

            <div
              className="feature-card"
            >
              <div className="feature-icon mint">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect
                    x="3"
                    y="8"
                    width="14"
                    height="9"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M6 8V5a4 4 0 018 0v3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                  />
                </svg>
              </div>
              <h3>Full Transparency</h3>
              <p>
                Every transaction, every provider selection, every on-chain
                action is visible and verifiable. Open source, fully auditable,
                no black boxes.
              </p>
            </div>
          </div>
        </section>

        {/* Separator */}
        <div className="section-sep">
          <div className="line" />
        </div>

        {/* How It Works */}
        <section className="how-section">
          <div className="section-label">How It Works</div>
          <h2 className="section-heading">Three steps to start earning</h2>
          <p className="section-sub">
            No prior infrastructure knowledge needed. Connect, choose your
            providers, and stake.
          </p>

          <div className="steps">
            <div
              className="step"
            >
              <div className="step-number">01</div>
              <h4>Connect Your Wallet</h4>
              <p>
                Link your Pocket wallet to Igniter. Your keys stay with you —
                Igniter never has access to your private keys.
              </p>
            </div>
            <div
              className="step"
            >
              <div className="step-number">02</div>
              <h4>Choose Providers</h4>
              <p>
                Browse participating staking providers. Review their terms,
                performance, and commission rates — then allocate your stake.
              </p>
            </div>
            <div
              className="step"
            >
              <div className="step-number">03</div>
              <h4>Stake &amp; Earn</h4>
              <p>
                Confirm your transaction on-chain. Your tokens begin working
                immediately, earning rewards through the providers you selected.
              </p>
            </div>
          </div>
        </section>

        {/* Separator */}
        <div className="section-sep">
          <div className="line" />
        </div>

        {/* Open Source */}
        <section className="opensource-section">
          <div className="opensource-card">
            <div className="opensource-content">
              <div className="section-label">Open Source</div>
              <h2>Built in public. Audit everything.</h2>
              <p>
                Igniter is fully open source. Review the code, verify the logic,
                and contribute improvements. Trust comes from transparency, not
                promises.
              </p>
              <div className="opensource-links">
                <a
                  href="https://github.com/pokt-network/igniter"
                  className="link-chip"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  View on GitHub
                </a>
                <a
                  href="https://docs.pocket.network"
                  className="link-chip"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
                    <path d="M10 2v3h3M5 8h6M5 11h4" />
                  </svg>
                  Documentation
                </a>
              </div>
            </div>
            <div className="opensource-visual">
              <div className="code-block-deco">
                <div className="titlebar">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
                <div className="code-lines">
                  <span className="cmt">{"// igniter.config.ts"}</span>
                  <br />
                  <span className="kw">export const</span> config = {"{"}
                  <br />
                  &nbsp;&nbsp;network:{" "}
                  <span className="str">&quot;shannon&quot;</span>,<br />
                  &nbsp;&nbsp;custody:{" "}
                  <span className="str">&quot;non-custodial&quot;</span>,<br />
                  &nbsp;&nbsp;providers:{" "}
                  <span className="str">&quot;multi&quot;</span>,<br />
                  {"}"}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Built By */}
        <section className="builders-section">
          <div
            className="section-label"
            style={{ textAlign: "center", marginBottom: 28 }}
          >
            Built By
          </div>
          <div className="builders-row">
            <a
              href="https://trustsoothe.io/"
              className="builder-card"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="builder-logo">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3l-8 4.5v9L12 21l8-4.5v-9L12 3z"
                    stroke="var(--text-secondary)"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M12 12l8-4.5M12 12v9M12 12L4 7.5"
                    stroke="var(--text-secondary)"
                    strokeWidth="1"
                  />
                </svg>
              </div>
              <div className="builder-info">
                <h4>Soothe</h4>
                <p>
                  The development team behind Igniter&apos;s non-custodial
                  staking platform.
                </p>
                <span className="builder-link">trustsoothe.io →</span>
              </div>
            </a>

            <a
              href="https://www.poktscan.com/"
              className="builder-card"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div
                className="builder-logo"
                style={{
                  fontWeight: 800,
                  fontSize: "0.7rem",
                  letterSpacing: "-0.03em",
                  color: "var(--text-primary)",
                }}
              >
                PS
              </div>
              <div className="builder-info">
                <h4>POKTScan</h4>
                <p>
                  Also by the Soothe team — the network explorer trusted by the
                  Pocket community.
                </p>
                <span className="builder-link">poktscan.com →</span>
              </div>
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="landing-footer">
          <div className="footer-left">
            <FooterLogo />
            <span className="footer-copyright">
              © 2026 Pocket Network Foundation
            </span>
          </div>
          <div className="footer-links">
            <a
              href="https://pocket.network/privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy
            </a>
            <a
              href="https://pocket.network/terms-of-use/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms
            </a>
            <a
              href="https://docs.pocket.network"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </a>
            <a
              href="https://github.com/pokt-network/igniter"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}

function FooterLogo() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const Logo = resolvedTheme === "light" ? PocketLogoBlack : PocketLogoWhite;

  return <Logo className="footer-logo" />;
}
