import type { Metadata } from "next";
import React from 'react'
import CurrentUser from '@/components/CurrentUser'
import { GetAppName } from '@/actions/ApplicationSettings'
import ParticleBackground from './ParticleBackground'
import "./landing.css";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()

  return {
    title: `Sign In - ${appName}`,
    description: `Provider administration panel for ${appName}`,
  }
}

export default function Landing() {
  return (
    <>
      <ParticleBackground />
      <div className="bg-canvas">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>
      <div className="landing-dot-grid" />

      <div className="provider-login-wrapper">
        <div className="provider-login-badge">
          <span className="pulse" />
          Provider Administration
        </div>

        <div className="provider-login-card">
          <div className="provider-login-icon-wrapper">
            <div className="provider-login-icon-ring" />
            <div className="provider-login-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M12 12l9-5M12 12v10M12 12L3 7"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.6"
                />
              </svg>
            </div>
          </div>

          <h1>Stake Igniter</h1>
          <p className="subtitle">
            Sign in with your owner wallet to manage supplier keys, services, and staking operations.
          </p>

          <div className="connect-area">
            <CurrentUser />
          </div>

          <p className="hint">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="7" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3" fill="none" />
            </svg>
            Only the registered owner can access this panel
          </p>
        </div>

        <div className="provider-features">
          <div className="provider-feature-pill">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1L2 4.5v7L8 15l6-3.5v-7L8 1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
            Supplier Keys
          </div>
          <div className="provider-feature-pill">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Services
          </div>
          <div className="provider-feature-pill">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 11l4-4 3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 5h4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Staking Ops
          </div>
          <a
            href="https://github.com/pokt-network/igniter"
            className="provider-feature-pill provider-help-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M6 6.5a2 2 0 013.5 1.5c0 1-1.5 1.5-1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.5" fill="currentColor" />
            </svg>
            Help &amp; Docs
          </a>
        </div>
      </div>
    </>
  )
}
